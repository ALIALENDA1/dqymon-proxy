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

const dgram = require("dgram");
const crypto = require("crypto");
const config = require("./config/config");
const PacketHandler = require("./handlers/PacketHandler");
const CommandHandler = require("./handlers/CommandHandler");
const Logger = require("./utils/Logger");
const LoginServer = require("./utils/LoginServer");
const GameLauncher = require("./utils/GameLauncher");
const ENetParser = require("./utils/ENetParser");

const logger = new Logger();

// Session timeout: clean up sessions with no activity for 60 seconds
const SESSION_TIMEOUT_MS = 60 * 1000;

class GrowtopiaProxy {
  constructor() {
    // clientKey ("addr:port") → session object
    this.sessions = new Map();
    this.packetHandler = new PacketHandler();
    this.commandHandler = new CommandHandler(this);
    this.proxySocket = null;       // Main UDP socket (client ↔ proxy)
    this.loginServer = null;       // set after construction
    // Queue of pending sub-server redirects (survives session teardown).
    this.pendingServerQueue = [];
  }

  start() {
    this.proxySocket = dgram.createSocket("udp4");

    this.proxySocket.on("message", (msg, rinfo) => {
      const clientKey = `${rinfo.address}:${rinfo.port}`;

      // Create session on first packet from this client
      if (!this.sessions.has(clientKey)) {
        this.createSession(clientKey, rinfo);
      }

      const session = this.sessions.get(clientKey);
      session.lastActivity = Date.now();
      session.clientPackets = (session.clientPackets || 0) + 1;

      // Log first few packets and then periodically at info level
      if (session.clientPackets <= 3 || session.clientPackets % 50 === 0) {
        logger.info(
          `[${session.clientId}] Client → Server: ${msg.length} bytes (pkt #${session.clientPackets})`
        );
      }

      // Inspect Growtopia payloads inside the ENet datagram
      const modified = this.inspectClientDatagram(session, msg);

      // Forward to real GT server
      session.serverSocket.send(
        modified, 0, modified.length,
        session.serverPort, session.serverHost,
        (err) => {
          if (err) {
            logger.error(`[${session.clientId}] Failed to send to GT server: ${err.message}`);
          }
        }
      );
    });

    this.proxySocket.on("error", (err) => {
      logger.error(`Proxy socket error: ${err.message}`);
    });

    this.proxySocket.bind(config.proxy.port, config.proxy.host, () => {
      logger.info(
        `✓ UDP proxy started on ${config.proxy.host}:${config.proxy.port}`
      );
    });

    // Periodically clean up stale sessions
    setInterval(() => this.cleanupStaleSessions(), 15000);
  }

  /**
   * Create a new session for a client. Allocates a dedicated server-side
   * UDP socket so each client has an isolated connection to the GT server.
   */
  createSession(clientKey, rinfo) {
    const clientId = crypto.randomBytes(6).toString("hex");

    // Determine target server: pending redirect → login response → static config
    let serverHost, serverPort;
    if (this.pendingServerQueue.length > 0) {
      const pending = this.pendingServerQueue.shift();
      serverHost = pending.host;
      serverPort = pending.port;
    } else if (this.loginServer && this.loginServer.realServerHost) {
      serverHost = this.loginServer.realServerHost;
      serverPort = this.loginServer.realServerPort;
    } else {
      serverHost = config.serverConfig.host;
      serverPort = config.serverConfig.port;
    }

    const serverSocket = dgram.createSocket("udp4");

    const session = {
      clientId,
      clientAddr: rinfo.address,
      clientPort: rinfo.port,
      serverSocket,
      serverHost,
      serverPort,
      lastActivity: Date.now(),
    };

    // Server → Client relay
    serverSocket.on("message", (serverMsg, serverInfo) => {
      session.lastActivity = Date.now();
      session.serverPackets = (session.serverPackets || 0) + 1;

      // Log first few packets and then periodically at info level
      if (session.serverPackets <= 3 || session.serverPackets % 50 === 0) {
        logger.info(
          `[${clientId}] Server → Client: ${serverMsg.length} bytes from ${serverInfo.address}:${serverInfo.port} (pkt #${session.serverPackets})`
        );
      }

      // Inspect/modify server-to-client traffic (OnSendToServer, etc.)
      const modified = this.inspectServerDatagram(session, serverMsg);

      // Relay back to the game client via the main proxy socket
      this.proxySocket.send(
        modified, 0, modified.length,
        session.clientPort, session.clientAddr,
        (err) => {
          if (err) {
            logger.error(`[${clientId}] Failed to send to client: ${err.message}`);
          }
        }
      );
    });

    serverSocket.on("error", (err) => {
      logger.error(`[${clientId}] Server socket error: ${err.message}`);
    });

    // Log when the server socket is ready
    serverSocket.on("listening", () => {
      const addr = serverSocket.address();
      logger.info(`[${clientId}] Server socket bound to ${addr.address}:${addr.port}`);
    });

    this.sessions.set(clientKey, session);
    logger.info(`[${clientId}] New session: ${clientKey} → ${serverHost}:${serverPort}`);
  }

  // ── Datagram inspection ───────────────────────────────────────────

  /**
   * Inspect a client-to-server datagram for Growtopia commands.
   * Returns the (possibly modified) datagram buffer.
   */
  inspectClientDatagram(session, buf) {
    try {
      const payloads = ENetParser.extractPayloads(buf);
      for (const { cmd, data } of payloads) {
        this.handleClientPayload(session, data);
      }
    } catch (e) {
      // Parsing failed — just relay unmodified
    }
    // Always forward the original datagram (commands are logged but not stripped,
    // to avoid breaking ENet reliable sequence flow).
    return buf;
  }

  /**
   * Inspect a server-to-client datagram for OnSendToServer redirects.
   * Returns the (possibly modified) datagram buffer.
   */
  inspectServerDatagram(session, buf) {
    try {
      const payloads = ENetParser.extractPayloads(buf);
      for (const { cmd, data } of payloads) {
        const modified = this.handleServerPayload(session, data);
        if (modified && modified !== data) {
          // Replace this payload in the ENet datagram
          return ENetParser.replacePayload(buf, cmd, modified);
        }
      }
    } catch (e) {
      // Parsing failed — relay unmodified
    }
    return buf;
  }

  // ── Growtopia-level payload handlers ──────────────────────────────

  /**
   * Inspect a Growtopia payload from client→server traffic.
   * Detects and logs commands.
   */
  handleClientPayload(session, data) {
    if (data.length < 4) return;

    const msgType = data.readUInt32LE(0);

    // Only look at text packets (type 2 = login info, type 3 = action/text)
    if (msgType === 2 || msgType === 3) {
      const text = data.toString("utf8", 4, Math.min(data.length, 260));
      const prefix = config.commands.prefix;

      if (text.startsWith(prefix) || text.includes(`|text|${prefix}`)) {
        const result = this.commandHandler.execute(session.clientId, text);
        if (result.handled) {
          logger.info(`[${session.clientId}] Command executed: ${result.command}`);
        }
      }
    }
  }

  /**
   * Inspect a Growtopia payload from server→client traffic.
   * Intercepts OnSendToServer (sub-server redirects) and rewrites
   * the target address to point back to our proxy.
   * Returns modified payload Buffer, or the original if unchanged.
   */
  handleServerPayload(session, data) {
    if (data.length <= 60) return data;

    try {
      const msgType = data.readUInt32LE(0);
      if (msgType !== 4) return data; // Not a TANK packet

      const tankType = data.readUInt32LE(4);
      if (tankType !== 1) return data; // Not CALL_FUNCTION

      const extraDataSize = data.readUInt32LE(56);
      if (extraDataSize === 0 || data.length < 60 + extraDataSize) return data;

      const extraData = data.slice(60);
      const varCount = extraData.readUInt8(0);
      if (varCount === 0) return data;

      // Read first variant to get function name
      let offset = 1; // skip count byte
      offset += 1; // skip index
      const type0 = extraData.readUInt8(offset); offset += 1;
      if (type0 !== 2 || offset + 4 > extraData.length) return data;

      const strLen = extraData.readUInt32LE(offset); offset += 4;
      if (offset + strLen > extraData.length) return data;

      const funcName = extraData.toString("utf8", offset, offset + strLen);
      if (funcName !== "OnSendToServer") return data;

      // Parse all variants: [0]=funcName, [1]=port, [2]=token, [3]=user, [4]=address
      logger.info(`[${session.clientId}] Intercepted OnSendToServer`);

      let realPort = 17091;
      let realToken = 0;
      let realUser = 0;
      let realAddress = null;
      let addressFull = "127.0.0.1|0|";

      try {
        let off2 = 1;
        for (let vi = 0; vi < varCount && off2 < extraData.length; vi++) {
          const vIdx = extraData.readUInt8(off2); off2 += 1;
          const vType = extraData.readUInt8(off2); off2 += 1;
          if (vType === 1) { off2 += 4; }
          else if (vType === 2) {
            const sLen = extraData.readUInt32LE(off2); off2 += 4;
            if (vIdx === 4) {
              addressFull = extraData.toString("utf8", off2, off2 + sLen);
              realAddress = addressFull.split("|")[0];
            }
            off2 += sLen;
          }
          else if (vType === 3) { off2 += 8; }
          else if (vType === 4) { off2 += 12; }
          else if (vType === 5) {
            if (vIdx === 1) realPort = extraData.readUInt32LE(off2);
            else if (vIdx === 2) realToken = extraData.readUInt32LE(off2);
            else if (vIdx === 3) realUser = extraData.readUInt32LE(off2);
            off2 += 4;
          }
          else if (vType === 9) {
            if (vIdx === 1) realPort = extraData.readInt32LE(off2);
            else if (vIdx === 2) realToken = extraData.readInt32LE(off2);
            else if (vIdx === 3) realUser = extraData.readInt32LE(off2);
            off2 += 4;
          }
        }
      } catch (e) { /* parsing error, use defaults */ }

      if (realAddress) {
        logger.info(`[${session.clientId}] Sub-server redirect: ${realAddress}:${realPort}`);
        this.pendingServerQueue.push({ host: realAddress, port: realPort });
      }

      // Rewrite: redirect client back to our proxy, preserving token/user/doorId
      const proxyHost = config.proxy.host === "0.0.0.0" ? "127.0.0.1" : config.proxy.host;
      const addrParts = addressFull.split("|");
      addrParts[0] = proxyHost;
      const rewrittenAddr = addrParts.join("|");

      return PacketHandler.buildVariantPacket([
        { type: 2, value: "OnSendToServer" },
        { type: 9, value: config.proxy.port },
        { type: 9, value: realToken },
        { type: 9, value: realUser },
        { type: 2, value: rewrittenAddr },
      ], -1, 0);
    } catch (e) {
      // Failed to parse — pass through unmodified
      return data;
    }
  }

  // ── Utility ────────────────────────────────────────────────────────

  /**
   * Send a Growtopia-level packet to a client.
   * NOTE: With raw UDP relay, we cannot inject ENet-framed packets
   * because we don't track ENet protocol state (peer IDs, sequence
   * numbers). This is a no-op for now; features that need injection
   * (command feedback, status overlay) log to the proxy console instead.
   */
  sendToClient(clientId, data) {
    // Cannot inject without ENet state tracking — log intent instead
    logger.debug(`[${clientId}] sendToClient skipped (raw UDP mode, ${data.length} bytes)`);
  }

  cleanup(clientKey) {
    const session = this.sessions.get(clientKey);
    if (!session) return;

    try { session.serverSocket.close(); } catch (e) { /* already closed */ }
    this.sessions.delete(clientKey);
    this.commandHandler.clearUserState(session.clientId);

    logger.info(`[${session.clientId}] Session cleaned up`);
  }

  cleanupStaleSessions() {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        logger.info(`[${session.clientId}] Session timed out`);
        this.cleanup(key);
      }
    }
  }

  getSession(clientId) {
    for (const session of this.sessions.values()) {
      if (session.clientId === clientId) return session;
    }
    return null;
  }
}

// Start proxy
const proxy = new GrowtopiaProxy();
const loginServer = new LoginServer();
const gameLauncher = new GameLauncher();

// The proxy needs access to the loginServer to read dynamic server address
proxy.loginServer = loginServer;

// Restore hosts file on any exit
function cleanup() {
  loginServer.removeCert();
  gameLauncher.cleanup();
  loginServer.stop();
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(); });
process.on("SIGTERM", () => { cleanup(); process.exit(); });

// 1. Start the raw UDP proxy
proxy.start();

// 2. Start the fake login server (serves server_data.php → proxy)
loginServer.start();

// 3. Run diagnostics after servers are up
setTimeout(() => {
  loginServer.diagnose();
}, 2000);

// 4. Redirect Growtopia domains to 127.0.0.1 & launch the game
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
logger.info("Proxy is running. Press Ctrl+C to stop.");
if (process.stdin.isTTY) {
  process.stdin.resume();
}

} catch (err) {
  // This catches require() failures and any synchronous startup errors
  console.error(`\n[FATAL] Startup failed: ${err.message}\n${err.stack}`);
  pauseBeforeExit("\nPress ENTER to exit...").then(() => process.exit(1));
}
