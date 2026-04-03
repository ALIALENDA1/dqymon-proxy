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
    this.gameEventLogger = new GameEventLogger();
    this.loginServer = null;       // set after construction
    // Queue of pending sub-server redirects (survives session teardown).
    this.pendingServerQueue = [];
    // Global packet counters
    this.totalClientPackets = 0;
    this.totalServerPackets = 0;
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
          // Use disconnectNow() instead of reset() — sends a proper DISCONNECT
          // notification to the GT server so it can activate the sub-server token.
          // reset() drops silently, which can cause "Bad logon" on sub-server.
          const peer = this.outgoingClient.host.getPeer(this.session.serverNetID);
          peer.disconnectNow(this.outgoingClient.host, 0);
          logger.debug(`[${this.session.clientId}] Sent disconnect to GT server ${this.session.serverHost}:${this.session.serverPort}`);
        } catch (e) {}
      }
    }

    this.session = {
      clientId,
      clientNetID: netID,
      serverNetID: null,
      serverHost,
      serverPort,
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
    this.outgoingClient.connect(serverHost, serverPort);
    logger.info(`[${clientId}] Connecting to GT server ${serverHost}:${serverPort}...`);

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
      // Buffer until outgoing connection is established
      this.session.pendingClientData.push({ ch, data: modified });
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

    // Disconnect from GT server too
    if (this.session.serverNetID !== null) {
      try {
        const peer = this.outgoingClient.host.getPeer(this.session.serverNetID);
        peer.disconnectNow(this.outgoingClient.host, 0);
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

    logger.info(`[${this.session.clientId}] GT server disconnected (netID=${netID})`);

    // Don't disconnect the game client — it may reconnect for sub-server redirect
    this.session.connected = false;
    this.session.serverNetID = null;
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

    // Type 2 = login info — spoof device fingerprints
    if (msgType === 2) {
      if (!session.loginReceived) {
        session.loginReceived = true;
        logger.info(`[${session.clientId}] ✓ Login packet received — processing MAC spoof...`);
      }
      return this.spoofLoginInfo(session, data);
    }

    // Type 3 = action/text — log actions and check commands
    if (msgType === 3) {
      const text = data.toString("utf8", 4, Math.min(data.length, 2048)).replace(/\0+$/, "");
      const prefix = config.commands.prefix;

      // Log the client action (world join, drop, chat, etc.)
      this.gameEventLogger.processClientAction(text);

      // Check for proxy commands — extract command text from either
      // plain "/cmd" or GT action format "action|input\ntext|/cmd"
      let cmdText = null;
      if (text.startsWith(prefix)) {
        cmdText = text;
      } else {
        const textMatch = text.match(/\|text\|(.+)/);
        if (textMatch && textMatch[1].startsWith(prefix)) {
          cmdText = textMatch[1];
        }
      }

      if (cmdText) {
        const result = this.commandHandler.execute(session.clientId, cmdText);
        if (result.handled) {
          logger.info(`[${session.clientId}] Command executed: ${result.command}`);
          // Block command from reaching server — return null to suppress
          return null;
        }
      }
    }

    // Type 4 = TANK — log tile/item events
    if (msgType === 4 && data.length >= 60) {
      const tankType = data.readUInt32LE(4);
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
    if (extraDataSize === 0 || data.length < 60 + extraDataSize) return data;

    const extraData = data.slice(60);

    // Parse variants using the proper parser
    const variants = PacketHandler.parseVariantList(extraData);
    if (variants.length === 0) return data;

    // Log the game event
    const funcName = (variants[0] && variants[0].type === 2) ? variants[0].value : "";
    logger.info(`[${session.clientId}] Variant call: ${funcName} (${variants.length} args)`);
    this.gameEventLogger.processVariantCall(variants, session.clientId);

    // Handle OnSendToServer — rewrite target to proxy
    if (funcName !== "OnSendToServer") return data;

    logger.info(`[${session.clientId}] Intercepted OnSendToServer`);

    let realPort = 17091;
    let realToken = 0;
    let realUser = 0;
    let realAddress = null;
    let addressFull = "127.0.0.1|0|";
    // Preserve original variant types for port/token/user
    let portType = 9, tokenType = 9, userType = 9;

    for (const v of variants) {
      if (v.index === 1 && (v.type === 5 || v.type === 9)) { realPort = v.value; portType = v.type; }
      if (v.index === 2 && (v.type === 5 || v.type === 9)) { realToken = v.value; tokenType = v.type; }
      if (v.index === 3 && (v.type === 5 || v.type === 9)) { realUser = v.value; userType = v.type; }
      if (v.index === 4 && v.type === 2) {
        addressFull = v.value;
        realAddress = addressFull.split("|")[0];
      }
    }

    if (realAddress) {
      logger.info(`[${session.clientId}] Sub-server redirect: ${realAddress}:${realPort}`);
      logger.info(`[${session.clientId}] Token=${realToken} User=${realUser} Addr=${addressFull}`);
      this.pendingServerQueue.push({ host: realAddress, port: realPort });
    }

    // Rewrite: redirect client back to our proxy, preserving token/user/doorId
    const proxyHost = config.proxy.host === "0.0.0.0" ? "127.0.0.1" : config.proxy.host;
    const addrParts = addressFull.split("|");
    addrParts[0] = proxyHost;
    const rewrittenAddr = addrParts.join("|");

    return PacketHandler.buildVariantPacket([
      { type: 2, value: "OnSendToServer" },
      { type: portType, value: config.proxy.port },
      { type: tokenType, value: realToken },
      { type: userType, value: realUser },
      { type: 2, value: rewrittenAddr },
    ], -1, 0);
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
      mac: spoofConfig.mac === "random" ? randomMAC() : (spoofConfig.mac || randomMAC()),
      rid: spoofConfig.rid === "random" ? randomHex(16).toUpperCase() : (spoofConfig.rid || randomHex(16)),
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
    let text = data.toString("utf8", 4).replace(/\0+$/, "");

    // Parse the login pairs for logging
    const pairs = {};
    for (const line of text.split("\n")) {
      const idx = line.indexOf("|");
      if (idx !== -1) pairs[line.substring(0, idx)] = line.substring(idx + 1);
    }

    // Log original login info
    this.gameEventLogger.logLoginInfo(pairs);

    if (!this.spoofState.enabled) return data;

    // Replace device fingerprints
    const replace = (key, value) => {
      const regex = new RegExp(`^${key}\\|.+$`, "m");
      if (regex.test(text)) {
        text = text.replace(regex, `${key}|${value}`);
      }
    };

    replace("mac", this.spoofState.mac);
    replace("rid", this.spoofState.rid);
    replace("hash", this.spoofState.hash);
    replace("hash2", this.spoofState.hash2);
    replace("fhash", this.spoofState.fhash);
    replace("zf", this.spoofState.zf);

    logger.info(`[${session.clientId}] ✓ Spoofed login: MAC=${this.spoofState.mac} RID=${this.spoofState.rid.substring(0, 8)}...`);

    // Rebuild the binary payload
    const header = Buffer.alloc(4);
    header.writeUInt32LE(2, 0);
    return Buffer.concat([header, Buffer.from(text, "utf8")]);
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

    // Disconnect both peers — use disconnectNow to notify remote side
    if (this.session.serverNetID !== null) {
      try {
        const peer = this.outgoingClient.host.getPeer(this.session.serverNetID);
        peer.disconnectNow(this.outgoingClient.host, 0);
      } catch (e) {}
    }
    if (this.session.clientNetID !== null) {
      try {
        const peer = this.serverClient.host.getPeer(this.session.clientNetID);
        peer.disconnectNow(this.serverClient.host, 0);
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
loginServer.gameLog = gameLog;

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
