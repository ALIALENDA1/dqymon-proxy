// ── Synchronous "pause" so the console window never closes silently ───
const readline = require("readline");

function pauseBeforeExit(msg) {
  try {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(msg, () => { rl.close(); resolve(); });
    });
  } catch {
    // If stdin isn't available, just wait 30 seconds
    return new Promise((resolve) => setTimeout(resolve, 30000));
  }
}

process.on("uncaughtException", async (err) => {
  console.error(`\n[FATAL] ${err.message}\n${err.stack}`);
  await pauseBeforeExit("\nPress ENTER to exit...");
  process.exit(1);
});

process.on("unhandledRejection", async (err) => {
  console.error(`\n[FATAL] Unhandled rejection: ${err}`);
  await pauseBeforeExit("\nPress ENTER to exit...");
  process.exit(1);
});
// ────────────────────────────────────────────────────────────────────────

try {

const crypto = require("crypto");
const config = require("./config/config");
const PacketHandler = require("./handlers/PacketHandler");
const CommandHandler = require("./handlers/CommandHandler");
const MenuHandler = require("./handlers/MenuHandler");
const Logger = require("./utils/Logger");
const LoginServer = require("./utils/LoginServer");
const GameLauncher = require("./utils/GameLauncher");
const GameLog = require("./utils/GameLog");
const GameEventLogger = require("./utils/GameEventLogger");
const { Client: ENetClient } = require("growtopia.js");

const logger = new Logger();
const gameLog = new GameLog();

class GrowtopiaProxy {
  constructor() {
    this.serverClient = null;    // ENet server accepting game connections (port 17091)
    this.outgoingClient = null;  // ENet client connecting to real GT server
    this.session = null;         // Current active session
    this.packetHandler = new PacketHandler();
    this.commandHandler = new CommandHandler(this);
    this.menuHandler = new MenuHandler(this);
    this.gameEventLogger = new GameEventLogger();
    this.loginServer = null;       // set after construction
    // Queue of pending sub-server redirects (survives session teardown).
    this.pendingServerQueue = [];
    // Global packet counters
    this.totalClientPackets = 0;
    this.totalServerPackets = 0;
    // Proxy start time for uptime tracking
    this.startTime = Date.now();
    // Device spoofing state (generated once per proxy session)
    this.spoofState = this.generateSpoofState();
  }

  start() {
    // ── ENet Server (port 17091) ──
    // Accepts incoming connections from the Growtopia game client.
    // Uses GT's custom ENet handshake (useNewServerPacket).
    this.serverClient = new ENetClient({
      enet: {
        ip: config.proxy.host === "0.0.0.0" ? "0.0.0.0" : config.proxy.host,
        port: config.proxy.port,
        maxPeers: 32,
        channelLimit: 2,
        useNewPacket: { asClient: false },
        useNewServerPacket: true,
      }
    });

    this.serverClient.on("ready", () => {
      logger.info(
        `✓ ENet server listening on ${config.proxy.host}:${config.proxy.port}`
      );
      if (this.spoofState.enabled) {
        logger.info(`✓ Spoofing: MAC=${this.spoofState.mac} RID=${this.spoofState.rid.substring(0, 8)}...`);
      }
    });

    this.serverClient.on("connect", (netID) => this.onClientConnect(netID));
    this.serverClient.on("raw", (netID, ch, data) => this.onClientData(netID, ch, data));
    this.serverClient.on("disconnect", (netID) => this.onClientDisconnect(netID));
    this.serverClient.on("error", (err) => {
      logger.error(`ENet server error: ${err.message}`);
    });

    // Outgoing client is created lazily in onClientConnect() to avoid
    // a crash in rusty_enet when two idle hosts with zero peers run
    // their service loops simultaneously.

    // Start the server
    this.serverClient.listen();
  }

  /**
   * Ensure the outgoing ENet client exists.
   * Created lazily and reused across sessions.
   */
  ensureOutgoingClient() {
    if (this.outgoingClient) return;

    this.outgoingClient = new ENetClient({
      enet: {
        ip: "0.0.0.0",
        port: 0,
        maxPeers: 1,
        channelLimit: 2,
        useNewPacket: { asClient: true },
        useNewServerPacket: false,
      }
    });

    this.outgoingClient.on("ready", () => {
      logger.info(`✓ ENet outgoing client ready (port ${this.outgoingClient.host.port})`);
    });

    this.outgoingClient.on("connect", (netID) => this.onServerConnect(netID));
    this.outgoingClient.on("raw", (netID, ch, data) => this.onServerData(netID, ch, data));
    this.outgoingClient.on("disconnect", (netID) => this.onServerDisconnect(netID));
    this.outgoingClient.on("error", (err) => {
      logger.error(`ENet outgoing error: ${err.message}`);
    });

    this.outgoingClient.listen();
  }

  /**
   * Game client connected to our ENet server.
   */
  onClientConnect(netID) {
    const clientId = crypto.randomBytes(6).toString("hex");

    // Determine target server: pending redirect → login response → static config
    let serverHost, serverPort;
    let isSubServerRedirect = false;
    if (this.pendingServerQueue.length > 0) {
      const pending = this.pendingServerQueue.shift();
      serverHost = pending.host;
      serverPort = pending.port;
      isSubServerRedirect = true;
    } else if (this.loginServer && this.loginServer.realServerHost) {
      serverHost = this.loginServer.realServerHost;
      serverPort = this.loginServer.realServerPort;
    } else {
      serverHost = config.serverConfig.host;
      serverPort = config.serverConfig.port;
    }

    // Clean up any previous session
    if (this.session) {
      if (this.session.noResponseTimer) clearTimeout(this.session.noResponseTimer);
      if (this.session.serverNetID !== null) {
        try {
          // Flush pending data FIRST, then send a RELIABLE disconnect.
          // disconnectNow() sends an UNRELIABLE disconnect that can be lost
          // in transit — if the gateway never receives it, the sub-server
          // session token is never activated → "Bad logon".
          const peer = this.outgoingClient.host.getPeer(this.session.serverNetID);
          this.outgoingClient.host.flush();
          try {
            peer.disconnect(this.outgoingClient.host, 0);
            this.outgoingClient.host.flush();
            peer.reset();   // free peer slot after DISCONNECT is on the wire
          } catch (_) {
            peer.disconnectNow(this.outgoingClient.host, 0);
            this.outgoingClient.host.flush();
          }
          logger.info(`[${this.session.clientId}] ✓ Sent disconnect to GT server ${this.session.serverHost}:${this.session.serverPort}`);
        } catch (e) {
          logger.debug(`[${this.session.clientId}] Disconnect error: ${e.message}`);
        }
      }
    }

    this.session = {
      clientId,
      clientNetID: netID,
      serverNetID: null,
      serverHost,
      serverPort,
      isSubServerRedirect,
      lastActivity: Date.now(),
      clientPackets: 0,
      serverPackets: 0,
      handshakeComplete: false,
      loginReceived: false,
      connected: false,         // true when outgoing ENet connection is established
      pendingClientData: [],    // buffer client data until outgoing is connected
      noResponseTimer: null,
    };

    logger.info(`[${clientId}] Game client connected (netID=${netID}) → ${serverHost}:${serverPort}`);
    gameLog.logConnection(clientId, `${serverHost}:${serverPort}`);

    if (this.loginServer && this.loginServer.maintenanceDetected) {
      logger.info(`[${clientId}] Note: server_data had #maint flag`);
    }

    // Only regenerate spoof identity for fresh logins, NOT sub-server redirects.
    // The sub-server validates the login token against the device fingerprints
    // from the initial login — changing them causes "Bad logon".
    if (!isSubServerRedirect) {
      this.spoofState = this.generateSpoofState();
      if (this.spoofState.enabled) {
        logger.info(`[${clientId}] ✓ New spoof identity: MAC=${this.spoofState.mac} RID=${this.spoofState.rid.substring(0, 8)}...`);
      }
    } else if (this.spoofState.enabled) {
      logger.info(`[${clientId}] ✓ Keeping spoof identity for sub-server: MAC=${this.spoofState.mac}`);
    }

    // Reset game event logger state
    this.gameEventLogger.currentWorld = "";
    this.gameEventLogger.playerName = "";
    this.gameEventLogger.localNetID = -1;
    this.gameEventLogger.players.clear();

    // Ensure outgoing client exists, then connect to real GT server
    this.ensureOutgoingClient();

    if (isSubServerRedirect) {
      // Delay the sub-server connection so the gateway has time to process
      // our DISCONNECT and activate the sub-server session token.
      // Without this, the sub-server checks the token before the gateway
      // has registered the redirect → "Bad logon".
      logger.info(`[${clientId}] Sub-server redirect — waiting 500ms for gateway to finalize...`);
      const savedId = clientId;
      setTimeout(() => {
        if (!this.session || this.session.clientId !== savedId) return;
        this.outgoingClient.connect(serverHost, serverPort);
        logger.info(`[${savedId}] Connecting to sub-server ${serverHost}:${serverPort}...`);
      }, 500);
    } else {
      this.outgoingClient.connect(serverHost, serverPort);
      logger.info(`[${clientId}] Connecting to GT server ${serverHost}:${serverPort}...`);
    }

    // Warn if GT server never responds
    this.session.noResponseTimer = setTimeout(() => {
      if (this.session && !this.session.connected && this.session.clientId === clientId) {
        logger.error(
          `[${clientId}] ✗ ENet handshake with GT server FAILED — ${serverHost}:${serverPort} did not respond`
        );
        if (this.loginServer && this.loginServer.maintenanceDetected) {
          logger.info(`[${clientId}] Note: server_data had #maint flag (server may still accept connections)`);
        }
        gameLog.logConnectionFail(
          clientId, `${serverHost}:${serverPort}`, "No response after 15s"
        );
      }
    }, 15000);
  }

  /**
   * Outgoing client connected to real GT server.
   */
  onServerConnect(netID) {
    if (!this.session) return;

    this.session.serverNetID = netID;
    this.session.connected = true;

    if (this.session.noResponseTimer) {
      clearTimeout(this.session.noResponseTimer);
      this.session.noResponseTimer = null;
    }

    logger.info(
      `[${this.session.clientId}] ✓ Connected to GT server ${this.session.serverHost}:${this.session.serverPort} (netID=${netID})`
    );
    gameLog.logConnectionSuccess(
      this.session.clientId,
      `${this.session.serverHost}:${this.session.serverPort}`
    );

    // Flush any client data that arrived before outgoing was ready
    for (const { ch, data } of this.session.pendingClientData) {
      this.outgoingClient.send(netID, ch, data);
    }
    this.session.pendingClientData = [];
  }

  /**
   * Game client sent a GT payload → inspect/modify → forward to GT server.
   */
  onClientData(netID, ch, data) {
    if (!this.session || this.session.clientNetID !== netID) return;

    this.session.lastActivity = Date.now();
    this.session.clientPackets++;
    this.totalClientPackets++;
    gameLog.logPacketSent();

    // Log first few packets and then periodically
    if (this.session.clientPackets <= 10 || this.session.clientPackets % 50 === 0) {
      const type = data.length >= 4 ? data.readUInt32LE(0) : -1;
      const typeName = { 1: "HELLO", 2: "LOGIN", 3: "TEXT", 4: "TANK" }[type] || "?";
      logger.info(
        `[${this.session.clientId}] Client → Server: type=${type}(${typeName}) ${data.length}b ch=${ch} (pkt #${this.session.clientPackets})`
      );
    }

    // Inspect and possibly modify GT payload (MAC spoofing, command detection)
    const modified = this.handleClientPayload(this.session, data);

    // null = command was handled locally, don't forward to server
    if (modified === null) return;

    // Forward to GT server
    if (this.session.connected && this.session.serverNetID !== null) {
      this.outgoingClient.send(this.session.serverNetID, ch, modified);
    } else {
      // Buffer until outgoing connection is established (cap at 200 to prevent memory leak)
      if (this.session.pendingClientData.length < 200) {
        this.session.pendingClientData.push({ ch, data: modified });
      } else {
        logger.warn(`[${this.session.clientId}] Pending buffer full — dropping client packet`);
      }
    }
  }

  /**
   * GT server sent a GT payload → inspect/modify → forward to game client.
   */
  onServerData(netID, ch, data) {
    if (!this.session) return;

    this.session.lastActivity = Date.now();
    this.session.serverPackets++;
    this.totalServerPackets++;
    gameLog.logPacketReceived();

    // First server data = relay is working
    if (this.session.serverPackets === 1) {
      this.session.handshakeComplete = true;
      logger.info(`[${this.session.clientId}] ✓ ENet relay active — game data flowing!`);
      logger.info(`[${this.session.clientId}] ✓ MAC spoofing and game event logging active`);
    }

    // Log first few packets and then periodically
    if (this.session.serverPackets <= 10 || this.session.serverPackets % 50 === 0) {
      const type = data.length >= 4 ? data.readUInt32LE(0) : -1;
      const typeName = { 1: "HELLO", 2: "LOGIN", 3: "TEXT", 4: "TANK" }[type] || "?";
      logger.info(
        `[${this.session.clientId}] Server → Client: type=${type}(${typeName}) ${data.length}b ch=${ch} (pkt #${this.session.serverPackets})`
      );
    }

    // Inspect and possibly modify GT payload (OnSendToServer redirect, etc.)
    const modified = this.handleServerPayload(this.session, data);

    // Forward to game client
    this.serverClient.send(this.session.clientNetID, ch, modified);
  }

  /**
   * Game client disconnected from our ENet server.
   */
  onClientDisconnect(netID) {
    if (!this.session || this.session.clientNetID !== netID) return;

    logger.info(
      `[${this.session.clientId}] Game client disconnected ` +
      `(${this.session.clientPackets} sent, ${this.session.serverPackets} received)`
    );

    // Disconnect from GT server — use graceful disconnect so the gateway
    // reliably receives the DISCONNECT (critical for sub-server token activation).
    if (this.session.serverNetID !== null) {
      try {
        const peer = this.outgoingClient.host.getPeer(this.session.serverNetID);
        this.outgoingClient.host.flush();
        try {
          peer.disconnect(this.outgoingClient.host, 0);
          this.outgoingClient.host.flush();
          peer.reset();
        } catch (_) {
          peer.disconnectNow(this.outgoingClient.host, 0);
          this.outgoingClient.host.flush();
        }
      } catch (e) {}
    }

    if (this.session.noResponseTimer) clearTimeout(this.session.noResponseTimer);
    this.commandHandler.clearUserState(this.session.clientId);
    this.session = null;
  }

  /**
   * Outgoing client disconnected from GT server.
   */
  onServerDisconnect(netID) {
    if (!this.session) return;
    // Ignore stale disconnect events from an old connection (e.g., gateway)
    // that could clobber the new sub-server session state.
    if (this.session.serverNetID !== null && this.session.serverNetID !== netID) return;

    logger.info(`[${this.session.clientId}] GT server disconnected (netID=${netID})`);

    // Don't disconnect the game client — it may reconnect for sub-server redirect
    this.session.connected = false;
    this.session.serverNetID = null;
    // Clear buffered data — stale packets must not be flushed to a new sub-server
    this.session.pendingClientData = [];
  }

  // ── Growtopia-level payload handlers ──────────────────────────────

  /**
   * Inspect a Growtopia payload from client→server traffic.
   * Handles: login spoofing (type 2), command detection (type 3),
   * action logging (type 3), and TANK events (type 4).
   * Returns modified payload Buffer if changed, or original.
   */
  handleClientPayload(session, data) {
    if (data.length < 4) return data;

    const msgType = data.readUInt32LE(0);

    // ── Proxy command interception (runs on BOTH type 2 and type 3) ──
    // GT sends chat as type 3 normally, but on sub-server connections it
    // can arrive as type 2. Check both for proxy commands.
    if (msgType === 2 || msgType === 3) {
      const prefix = config.commands.prefix;
      let cmdText = null;

      if (msgType === 2) {
        // Type 2 = binary login-format. Find "text|" in raw bytes and
        // extract the value. Hex-dump the area for debugging.
        const rawBytes = data.slice(4);
        const textMarker = Buffer.from("text|");
        const tIdx = rawBytes.indexOf(textMarker);

        if (tIdx !== -1) {
          // Hex dump for debugging the exact byte pattern
          const dumpStart = tIdx;
          const dumpEnd = Math.min(tIdx + 40, rawBytes.length);
          const hexDump = Array.from(rawBytes.slice(dumpStart, dumpEnd))
            .map(b => b.toString(16).padStart(2, "0")).join(" ");
          const asciiDump = Array.from(rawBytes.slice(dumpStart, dumpEnd))
            .map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
          logger.info(`[${session.clientId}] HEX text area: ${hexDump}`);
          logger.info(`[${session.clientId}] ASCII text area: ${asciiDump}`);

          const valStart = tIdx + textMarker.length;
          // Read until we hit a \n (0x0A) or \0 (0x00) — the field separator
          let valEnd = valStart;
          while (valEnd < rawBytes.length && rawBytes[valEnd] !== 0x0A && rawBytes[valEnd] !== 0x00) {
            valEnd++;
          }
          const rawVal = rawBytes.toString("utf8", valStart, valEnd);
          logger.info(`[${session.clientId}] Type2 raw text value: "${rawVal}" (${valEnd - valStart} bytes)`);

          // The command text is the raw value — any trailing junk byte will
          // be part of the match but won't affect command name extraction
          // since the switch/case matches the first word only
          if (rawVal.startsWith(prefix)) {
            cmdText = rawVal;
          }
        }
      } else {
        // Type 3 = normal text packet, clean utf8
        const text = data.toString("utf8", 4, Math.min(data.length, 2048)).replace(/\0+$/, "");
        this.gameEventLogger.processClientAction(text);

        if (text.startsWith(prefix)) {
          cmdText = text;
        } else {
          const textMatch = text.match(/(?:^|\n)\|?text\|([^\n]+)/);
          if (textMatch && textMatch[1].startsWith(prefix)) {
            cmdText = textMatch[1];
          }
        }
      }

      if (cmdText) {
        const result = this.commandHandler.execute(session.clientId, cmdText);
        if (result.handled) {
          logger.info(`[${session.clientId}] Command executed: ${result.command}`);
          return null;
        }
      }
    }

    // Type 2 = login info — spoof device fingerprints
    if (msgType === 2) {
      if (!session.loginReceived) {
        session.loginReceived = true;
        logger.info(`[${session.clientId}] ✓ Login packet received — processing MAC spoof...`);
      }
      return this.spoofLoginInfo(session, data);
    }

    // Type 3 dialog_return interception — check if this is a proxy dialog response
    if (msgType === 3) {
      const rawText = data.toString("utf8", 4, Math.min(data.length, 4096)).replace(/\0+$/, "");
      if (rawText.includes("action|dialog_return")) {
        const pairs = {};
        for (const line of rawText.split("\n")) {
          const sep = line.indexOf("|");
          if (sep !== -1) pairs[line.substring(0, sep).trim()] = line.substring(sep + 1).trim();
        }
        if (this.menuHandler.handleDialogReturn(session.clientId, pairs)) {
          return null; // consumed by proxy — don't forward to server
        }
      }
    }

    // Type 4 = TANK — log tile/item events
    if (msgType === 4 && data.length >= 60) {
      const tankType = data.readUInt32LE(4);
      const tankNames = { 0: "STATE", 1: "CALL_FUNC", 3: "TILE_REQ", 10: "INV", 18: "ITEM_OBJ", 25: "PING" };
      if (session.clientPackets <= 10) {
        logger.info(`[${session.clientId}] Client TANK sub-type: ${tankType}(${tankNames[tankType] || "?"}) ${data.length}b`);
      }
      this.gameEventLogger.processTankPacket(tankType, data.slice(4));
    }

    return data;
  }

  /**
   * Inspect a Growtopia payload from server→client traffic.
   * Parses ALL variant calls for game event logging, and
   * intercepts OnSendToServer for sub-server redirect rewriting.
   * Returns modified payload Buffer, or the original if unchanged.
   */
  handleServerPayload(session, data) {
    if (data.length < 4) return data;

    const msgType = data.readUInt32LE(0);

    // Log server text packets (type 2 / type 3) — info level for first 10
    if (msgType === 2 || msgType === 3) {
      const text = data.toString("utf8", 4, Math.min(data.length, 2048)).replace(/\0+$/, "");
      if (text.trim()) {
        if (session.serverPackets <= 10) {
          logger.info(`[${session.clientId}] Server text (type ${msgType}): ${text.substring(0, 200)}`);
        } else {
          logger.debug(`[${session.clientId}] Server text (type ${msgType}): ${text.substring(0, 120)}`);
        }
      }
    }

    // Only parse TANK packets (type 4) with sufficient length
    if (msgType !== 4 || data.length <= 60) return data;

    const tankType = data.readUInt32LE(4);

    // Log TANK events (tile updates, item objects, etc.)
    if (tankType !== 1) {
      this.gameEventLogger.processTankPacket(tankType, data.slice(4));
      return data;
    }

    // CALL_FUNCTION (tankType 1) — parse variant list
    const extraDataSize = data.readUInt32LE(56);
    if (extraDataSize === 0 || extraDataSize > 1048576 || data.length < 60 + extraDataSize) return data;

    const extraData = data.slice(60, 60 + extraDataSize);

    // Parse variants using the proper parser
    const variants = PacketHandler.parseVariantList(extraData);
    if (variants.length === 0) return data;

    // Log the game event
    const funcName = (variants[0] && variants[0].type === 2) ? variants[0].value : "";
    logger.info(`[${session.clientId}] Variant call: ${funcName} (${variants.length} args)`);
    this.gameEventLogger.processVariantCall(variants, session.clientId);

    // Handle OnSendToServer — rewrite target to proxy
    if (funcName !== "OnSendToServer") return data;

    logger.info(`[${session.clientId}] Intercepted OnSendToServer (${variants.length} args)`);

    // Log ALL variant arguments — critical for debugging Bad logon
    const typeNames = { 1: "float", 2: "string", 3: "vec2", 4: "vec3", 5: "uint32", 9: "int32" };
    for (const v of variants) {
      logger.info(`[${session.clientId}]   arg[${v.index}] (${typeNames[v.type] || "?"}) = ${JSON.stringify(v.value)}`);
    }

    let realPort = 17091;
    let realAddress = null;

    for (const v of variants) {
      if (v.index === 1 && (v.type === 5 || v.type === 9)) realPort = v.value;
      if (v.index === 4 && v.type === 2) {
        realAddress = v.value.split("|")[0];
      }
    }

    if (realAddress) {
      logger.info(`[${session.clientId}] Sub-server redirect: ${realAddress}:${realPort}`);
      this.pendingServerQueue.push({ host: realAddress, port: realPort });
    }

    // Rewrite OnSendToServer: preserve ALL original variant arguments,
    // only modify port (index 1) and address (index 4).
    // CRITICAL: the original packet has ${variants.length} args.
    // Previously we rebuilt with only 5, dropping args 5+ which
    // the GT client needs to construct a valid sub-server login.
    const proxyHost = config.proxy.host === "0.0.0.0" ? "127.0.0.1" : config.proxy.host;

    const modifiedVariants = variants.map(v => {
      // Rewrite port to proxy port
      if (v.index === 1 && (v.type === 5 || v.type === 9)) {
        return { type: v.type, value: config.proxy.port };
      }
      // Rewrite address IP to proxy host, keep doorID and UUID
      if (v.index === 4 && v.type === 2) {
        const parts = v.value.split("|");
        parts[0] = proxyHost;
        return { type: 2, value: parts.join("|") };
      }
      // Pass through ALL other variants unchanged (token, user, args 5+)
      return { type: v.type, value: v.value };
    });

    logger.info(`[${session.clientId}] Rewritten OnSendToServer → ${proxyHost}:${config.proxy.port} (${modifiedVariants.length} args preserved)`);

    // Rebuild packet: preserve original 56-byte tank header, only update variant data
    const modifiedVariantData = PacketHandler.serializeVariantList(modifiedVariants);
    const newPacket = Buffer.alloc(60 + modifiedVariantData.length);
    data.copy(newPacket, 0, 0, 60);  // Copy msgType(4) + original tank header(56)
    newPacket.writeUInt32LE(modifiedVariantData.length, 56);  // Update extraDataSize
    modifiedVariantData.copy(newPacket, 60);  // Append new variant data
    return newPacket;
  }

  // ── Device Spoofing ───────────────────────────────────────────────

  /**
   * Generate random device fingerprints for spoofing.
   */
  generateSpoofState() {
    const spoofConfig = config.spoof || {};
    if (!spoofConfig.enabled) return { enabled: false };

    const randomMAC = () => {
      // Generate unicast MAC (first byte even)
      const bytes = crypto.randomBytes(6);
      bytes[0] = (bytes[0] & 0xfe) | 0x02; // unicast + locally administered
      return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(":");
    };

    const randomHex = (len) => crypto.randomBytes(len).toString("hex");
    const randomInt = () => crypto.randomBytes(4).readUInt32LE(0);
    const randomSignedInt = () => crypto.randomBytes(4).readInt32LE(0);

    return {
      enabled: true,
      mac: String(spoofConfig.mac === "random" ? randomMAC() : (spoofConfig.mac || randomMAC())),
      rid: String(spoofConfig.rid === "random" ? randomHex(16).toUpperCase() : (spoofConfig.rid || randomHex(16))),
      hash: spoofConfig.hash === "random" ? randomInt() : (spoofConfig.hash || randomInt()),
      hash2: spoofConfig.hash2 === "random" ? randomInt() : (spoofConfig.hash2 || randomInt()),
      fhash: spoofConfig.fhash === "random" ? randomSignedInt() : (spoofConfig.fhash || randomSignedInt()),
      zf: spoofConfig.zf === "random" ? randomSignedInt() : (spoofConfig.zf || randomSignedInt()),
    };
  }

  /**
   * Modify login info packet to spoof device fingerprints.
   * Returns modified payload Buffer, or original if spoofing is disabled.
   */
  spoofLoginInfo(session, data) {
    const rawBytes = data.slice(4);

    // Debug: hex-dump around "zf|" for sub-server logins
    if (session.isSubServerRedirect) {
      const zfIdx = rawBytes.indexOf(Buffer.from("zf|", "latin1"));
      if (zfIdx >= 0) {
        const end = Math.min(zfIdx + 50, rawBytes.length);
        const hexDump = Array.from(rawBytes.slice(zfIdx, end))
          .map(b => b.toString(16).padStart(2, "0")).join(" ");
        logger.info(`[${session.clientId}] HEX zf area: ${hexDump}`);
      }
    }

    // ── Parse login packet into key→value pairs ──
    // The GT client uses \n between MOST fields, but concatenates some
    // WITHOUT any separator (confirmed via hex dump: zf|-1448935104lmode|1
    // has NO byte between "4" and "l", just consecutive printable ASCII).
    //
    // Strategy: convert to latin1, clean non-printable bytes, then use
    // exec() with /g to find all key| occurrences. exec() advances past
    // each match, so "zf|" at pos 0 advances to pos 3, skipping "f|" at
    // pos 1. Each key's value runs from after its | to the next key's start.
    const rawText = rawBytes.toString("latin1")
      .replace(/[^\x09\x0a\x20-\x7e]/g, "\n");  // non-printable → \n

    const pairOrder = [];
    const pairs = {};

    const keyRegex = /([a-zA-Z_]\w*)\|/g;
    const keyPositions = [];
    let m;
    while ((m = keyRegex.exec(rawText)) !== null) {
      keyPositions.push({ key: m[1], keyStart: m.index, valueStart: m.index + m[0].length });
    }
    for (let i = 0; i < keyPositions.length; i++) {
      const curr = keyPositions[i];
      const nextKeyStart = (i + 1 < keyPositions.length) ? keyPositions[i + 1].keyStart : rawText.length;
      const value = rawText.substring(curr.valueStart, nextKeyStart).replace(/[\n]+$/, "");
      pairs[curr.key] = value;
      if (!pairOrder.includes(curr.key)) pairOrder.push(curr.key);
    }

    // Log original login info + store for /checkacc
    this.gameEventLogger.logLoginInfo(pairs);
    this.gameEventLogger.lastLoginResponse = pairs;

    // Log key authentication fields for sub-server debugging
    const authFields = ["user", "token", "lmode", "UUIDToken", "doorID", "meta"];
    const authInfo = authFields.filter(f => pairs[f]).map(f => {
      const val = pairs[f];
      return `${f}=${val.length > 20 ? val.substring(0, 20) + "..." : val}`;
    }).join(" ");
    if (authInfo) {
      logger.info(`[${session.clientId}] Login auth: ${authInfo}`);
    }

    // For sub-server logins, log ALL fields
    if (session.isSubServerRedirect) {
      logger.info(`[${session.clientId}] ── Sub-server login packet (ALL fields) ──`);
      for (const key of pairOrder) {
        const v = pairs[key];
        const display = v.length > 60 ? v.substring(0, 60) + `... (${v.length}c)` : v;
        logger.info(`[${session.clientId}]   ${key} = ${display}`);
      }
      logger.info(`[${session.clientId}] ── End login packet ──`);
    }

    if (!this.spoofState.enabled) return data;

    // ── Spoof device fingerprints ──
    // Now that fields are properly separated (zf and lmode are distinct keys),
    // we can safely modify individual values without destroying adjacent fields.
    if (pairs.mac !== undefined) pairs.mac = this.spoofState.mac;
    if (pairs.rid !== undefined) pairs.rid = this.spoofState.rid;
    if (pairs.hash !== undefined) pairs.hash = String(this.spoofState.hash);
    if (pairs.hash2 !== undefined) pairs.hash2 = String(this.spoofState.hash2);
    if (pairs.fhash !== undefined) pairs.fhash = String(this.spoofState.fhash);
    if (pairs.zf !== undefined) pairs.zf = String(this.spoofState.zf);

    logger.info(`[${session.clientId}] ✓ Spoofed login: MAC=${this.spoofState.mac} RID=${this.spoofState.rid.substring(0, 8)}...`);

    // Rebuild packet with \n separators (server finds keys via indexOf, not line splitting)
    const text = pairOrder.map(k => `${k}|${pairs[k]}`).join("\n");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(2, 0);
    return Buffer.concat([header, Buffer.from(text + "\n\0", "latin1")]);
  }

  // ── Utility ────────────────────────────────────────────────────────

  /**
   * Send a Growtopia-level packet to a client.
   * With the ENet bridge, we can inject packets directly into the
   * game client's ENet connection.
   */
  sendToClient(clientId, data) {
    if (!this.session || this.session.clientId !== clientId) {
      logger.debug(`[${clientId}] sendToClient: no matching session`);
      return;
    }
    try {
      this.serverClient.send(this.session.clientNetID, 0, data);
    } catch (e) {
      logger.error(`[${clientId}] sendToClient failed: ${e.message}`);
    }
  }

  cleanup() {
    if (!this.session) return;

    if (this.session.noResponseTimer) clearTimeout(this.session.noResponseTimer);

    // Disconnect both peers — flush pending data, then graceful disconnect
    if (this.session.serverNetID !== null) {
      try {
        const peer = this.outgoingClient.host.getPeer(this.session.serverNetID);
        this.outgoingClient.host.flush();
        try {
          peer.disconnect(this.outgoingClient.host, 0);
          this.outgoingClient.host.flush();
          peer.reset();
        } catch (_) {
          peer.disconnectNow(this.outgoingClient.host, 0);
          this.outgoingClient.host.flush();
        }
      } catch (e) {}
    }
    if (this.session.clientNetID !== null) {
      try {
        const peer = this.serverClient.host.getPeer(this.session.clientNetID);
        this.serverClient.host.flush();
        try {
          peer.disconnect(this.serverClient.host, 0);
          this.serverClient.host.flush();
          peer.reset();
        } catch (_) {
          peer.disconnectNow(this.serverClient.host, 0);
          this.serverClient.host.flush();
        }
      } catch (e) {}
    }

    this.commandHandler.clearUserState(this.session.clientId);
    logger.info(`[${this.session.clientId}] Session cleaned up (${this.session.clientPackets} sent, ${this.session.serverPackets} received)`);
    this.session = null;
  }

  cleanupStaleSessions() {
    // No-op: with ENet bridge, connections are managed by the library
  }

  getSession(clientId) {
    if (this.session && this.session.clientId === clientId) return this.session;
    return null;
  }
}

// Start proxy
const proxy = new GrowtopiaProxy();
const loginServer = new LoginServer();
const gameLauncher = new GameLauncher();

// Show startup banner
Logger.banner([
  "dqymon-proxy v1.0",
  `Platform: ${process.platform} ${process.arch}`,
  `Time: ${new Date().toLocaleString()}`,
]);
Logger.section("Initializing");

// The proxy needs access to the loginServer to read dynamic server address
proxy.loginServer = loginServer;
proxy.gameLog = gameLog;
loginServer.gameLog = gameLog;

// Track world visit history for /history command
proxy.gameEventLogger.onWorldJoin = (world) => {
  const store = proxy.commandHandler.store;
  const history = store.get("worldHistory") || [];
  history.push({ world, time: Date.now() });
  // Keep last 50 entries
  if (history.length > 50) history.splice(0, history.length - 50);
  store.set("worldHistory", history);
  store.save();
};

// When a new login (server_data) is served, clear the current session.
// The game client may reconnect from the same or a different port.
loginServer.onNewLogin = (host, port) => {
  if (proxy.session) {
    logger.info(`[${proxy.session.clientId}] Clearing session (new login → ${host}:${port})`);
    proxy.cleanup();
  }
};

// Restore hosts file on any exit
function cleanup() {
  loginServer.removeCert();
  gameLauncher.cleanup();
  loginServer.stop();
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(); });
process.on("SIGTERM", () => { cleanup(); process.exit(); });

// 1. Start the ENet proxy bridge
proxy.start();

// 2. Start the fake login server (serves server_data.php → proxy)
loginServer.start();

// 3. Run diagnostics after servers are up
setTimeout(() => {
  Logger.section("Diagnostics");
  loginServer.diagnose();
}, 2000);

// 4. Redirect Growtopia domains to 127.0.0.1 & launch the game
Logger.section("Network Setup");
if (config.game && config.game.modifyHosts !== false) {
  const hostsOk = gameLauncher.modifyHosts();
  if (hostsOk) {
    // Verify the hosts file was written correctly
    gameLauncher.verifyHosts();
    // Flush DNS cache so Windows picks up the new hosts entries immediately
    gameLauncher.flushDns();
    // Add firewall rules so Windows doesn't block our ports
    gameLauncher.addFirewallRules();
    // Install our cert so GT's auth client trusts our HTTPS interception
    loginServer.installCert();
  }
}

if (config.game && config.game.autoLaunch !== false) {
  // Small delay so the proxy & login server are ready
  setTimeout(() => {
    gameLauncher.launch();
  }, 1500);
}

// Keep the console window alive
Logger.section("Ready");
logger.info("Proxy is running. Press Ctrl+C to stop.");
logger.info(`Game log: ${gameLog.logPath}`);
if (process.stdin.isTTY) {
  process.stdin.resume();
}

} catch (err) {
  // This catches require() failures and any synchronous startup errors
  console.error(`\n[FATAL] Startup failed: ${err.message}\n${err.stack}`);
  pauseBeforeExit("\nPress ENTER to exit...").then(() => process.exit(1));
}
