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
const GameLog = require("./utils/GameLog");

const logger = new Logger();
const gameLog = new GameLog();

// Session timeout: clean up sessions with no activity for 60 seconds
const SESSION_TIMEOUT_MS = 60 * 1000;

class GrowtopiaProxy {
  constructor() {
    // clientKey ("addr:port") → session object
    this.sessions = new Map();
    this.packetHandler = new PacketHandler();
    this.commandHandler = new CommandHandler(this);
    this.proxySocket = null;       // Client-facing UDP socket
    this.loginServer = null;       // set after construction
    // Queue of pending sub-server redirects (survives session teardown).
    this.pendingServerQueue = [];
    // Global packet counters
    this.totalClientPackets = 0;
    this.totalServerPackets = 0;
  }

  start() {
    this.proxySocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    this.proxySocket.on("message", (msg, rinfo) => {
      const clientKey = `${rinfo.address}:${rinfo.port}`;

      if (!this.sessions.has(clientKey)) {
        this.createSession(clientKey, rinfo);
      }

      const session = this.sessions.get(clientKey);
      session.lastActivity = Date.now();
      session.clientPackets = (session.clientPackets || 0) + 1;
      this.totalClientPackets++;

      // Log first few packets and then periodically
      if (session.clientPackets <= 3 || session.clientPackets % 50 === 0) {
        logger.info(
          `[${session.clientId}] Client → Server: ${msg.length} bytes (pkt #${session.clientPackets})`
        );
      }

      // Detailed ENet diagnostic for the very first packet
      if (session.clientPackets === 1) {
        this.logENetDiagnostic(session, msg);
      }

      // Inspect Growtopia payloads inside the ENet datagram
      const modified = this.inspectClientDatagram(session, msg);

      // Forward to real GT server via the session's dedicated socket.
      // Each session has its own UDP socket on an ephemeral port,
      // so GT server responses arrive on that socket regardless of
      // the source IP/port the server responds from.
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
   * Handle a response from the GT server, relay it back to the client.
   */
  handleServerMessage(session, msg, rinfo) {
    session.lastActivity = Date.now();
    session.serverPackets = (session.serverPackets || 0) + 1;
    this.totalServerPackets++;

    // First server response = connection established!
    if (session.serverPackets === 1) {
      logger.info(`[${session.clientId}] ✓ GT server responded! Connection established.`);
      logger.info(
        `[${session.clientId}] Response from ${rinfo.address}:${rinfo.port} ` +
        `(expected ${session.serverHost}:${session.serverPort})`
      );
      gameLog.logConnectionSuccess(
        session.clientId,
        `${session.serverHost}:${session.serverPort}`
      );
    }

    // Log first few packets and then periodically
    if (session.serverPackets <= 3 || session.serverPackets % 50 === 0) {
      logger.info(
        `[${session.clientId}] Server → Client: ${msg.length} bytes from ` +
        `${rinfo.address}:${rinfo.port} (pkt #${session.serverPackets})`
      );
    }

    // Inspect/modify server-to-client traffic (OnSendToServer, etc.)
    const modified = this.inspectServerDatagram(session, msg);

    // Relay back to the game client via the same proxy socket
    this.proxySocket.send(
      modified, 0, modified.length,
      session.clientPort, session.clientAddr,
      (err) => {
        if (err) {
          logger.error(`[${session.clientId}] Failed to send to client: ${err.message}`);
        }
      }
    );
  }

  /**
   * Create a new session with a dedicated server-facing UDP socket.
   * Each session gets its own socket so GT server responses arrive
   * directly, regardless of the server's source IP/port.
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

    // Each session gets its own UDP socket for server traffic.
    // All responses arriving on this socket's ephemeral port belong to
    // this session — no need to match by server IP/port.
    const serverSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    const session = {
      clientId,
      clientAddr: rinfo.address,
      clientPort: rinfo.port,
      serverHost,
      serverPort,
      serverSocket,
      lastActivity: Date.now(),
      clientPackets: 0,
      serverPackets: 0,
    };

    serverSocket.on("message", (msg, serverRinfo) => {
      this.handleServerMessage(session, msg, serverRinfo);
    });

    serverSocket.on("error", (err) => {
      logger.error(`[${clientId}] Server socket error: ${err.message}`);
    });

    serverSocket.bind(0, "0.0.0.0", () => {
      const addr = serverSocket.address();
      logger.info(`[${clientId}] Server socket bound to ${addr.address}:${addr.port}`);
    });

    this.sessions.set(clientKey, session);
    logger.info(`[${clientId}] New session: ${clientKey} → ${serverHost}:${serverPort}`);
    gameLog.logConnection(clientId, `${serverHost}:${serverPort}`);

    // If we know the server is in maintenance, warn immediately
    if (this.loginServer && this.loginServer.maintenanceDetected) {
      logger.warn(`[${clientId}] ⚠ GT server is in MAINTENANCE MODE — connection will likely time out`);
      gameLog.logMaintenance("GT server reported maintenance in server_data");
    }

    // Warn if GT server never responds after 10 seconds
    session.noResponseTimer = setTimeout(() => {
      if (!session.serverPackets) {
        logger.warn(
          `[${clientId}] ⚠ No response from GT server ${serverHost}:${serverPort} after 10 seconds!`
        );
        logger.warn(
          `[${clientId}] ⚠ Possible causes: Windows Firewall blocking inbound UDP, server maintenance, or network issue.`
        );
        gameLog.logConnectionFail(
          clientId,
          `${serverHost}:${serverPort}`,
          "No response after 10s"
        );
      }
    }, 10000);
  }

  // ── ENet diagnostics ─────────────────────────────────────────────

  /**
   * Parse and log detailed information about the first ENet packet
   * to verify it's a valid CONNECT and help debug connection failures.
   */
  logENetDiagnostic(session, buf) {
    const hex = buf.slice(0, Math.min(buf.length, 64)).toString("hex").match(/.{1,2}/g).join(" ");
    logger.info(`[${session.clientId}] ENet hex (first ${Math.min(buf.length, 64)}b): ${hex}`);

    if (buf.length < 4) {
      logger.warn(`[${session.clientId}] ENet: packet too small (${buf.length} bytes)`);
      return;
    }

    const peerID = buf.readUInt16BE(0);
    const hasSentTime = !!(peerID & 0x8000);
    const isCompressed = !!(peerID & 0x4000);
    const rawPeerID = peerID & 0x0FFF;

    logger.info(
      `[${session.clientId}] ENet header: peerID=${rawPeerID} sentTime=${hasSentTime} compressed=${isCompressed}`
    );

    if (isCompressed) {
      logger.warn(`[${session.clientId}] ENet: compressed datagram — cannot inspect further`);
      return;
    }

    let offset = 2 + (hasSentTime ? 2 : 0);

    // Try parsing: ENet without checksum first, then with
    let cmdByte = buf.length > offset ? buf[offset] : 0;
    let cmdType = cmdByte & 0x0F;
    let hasChecksum = false;

    if (cmdType < 1 || cmdType > 12) {
      // Maybe has a 4-byte checksum before commands
      if (buf.length > offset + 4) {
        const checksum = buf.readUInt32LE(offset);
        offset += 4;
        cmdByte = buf[offset];
        cmdType = cmdByte & 0x0F;
        hasChecksum = true;
        logger.info(`[${session.clientId}] ENet: CRC32 checksum present (0x${checksum.toString(16)})`);
      }
    }

    if (cmdType >= 1 && cmdType <= 12) {
      const cmdNames = {
        1: "ACKNOWLEDGE", 2: "CONNECT", 3: "VERIFY_CONNECT",
        4: "DISCONNECT", 5: "PING", 6: "SEND_RELIABLE",
        7: "SEND_UNRELIABLE", 8: "SEND_FRAGMENT", 9: "SEND_UNSEQUENCED",
      };
      const flags = [];
      if (cmdByte & 0x80) flags.push("ACK");
      if (cmdByte & 0x40) flags.push("UNSEQUENCED");

      logger.info(
        `[${session.clientId}] ENet cmd: ${cmdNames[cmdType] || `UNKNOWN(${cmdType})`} ` +
        `flags=[${flags.join(",")}] checksum=${hasChecksum}`
      );

      // For CONNECT, parse key fields
      if (cmdType === 2 && buf.length >= offset + 4 + 36) {
        const channelID = buf[offset + 1];
        const relSeq = buf.readUInt16BE(offset + 2);
        const connectStart = offset + 4;
        const outgoingPeerID = buf.readUInt16BE(connectStart);
        const mtu = buf.readUInt32BE(connectStart + 4);
        const windowSize = buf.readUInt32BE(connectStart + 8);
        const channelCount = buf.readUInt32BE(connectStart + 12);
        const connectID = buf.readUInt32BE(connectStart + 32);
        logger.info(
          `[${session.clientId}] CONNECT: outPeerID=${outgoingPeerID} ch=${channelID} ` +
          `seq=${relSeq} mtu=${mtu} wnd=${windowSize} channels=${channelCount} ` +
          `connectID=0x${connectID.toString(16)}`
        );
      }
    } else {
      logger.warn(
        `[${session.clientId}] ENet: cannot parse first command byte 0x${cmdByte.toString(16)} — ` +
        `may be compressed or unknown protocol`
      );
    }
  }

  /**
   * Probe the GT server by sending a minimal ENet CONNECT-like packet
   * from a separate socket to verify UDP reachability.
   */
  probeServer(host, port) {
    return new Promise((resolve) => {
      const probe = dgram.createSocket("udp4");
      let responded = false;

      probe.on("message", () => {
        responded = true;
        logger.info(`[PROBE] ✓ GT server ${host}:${port} responded to UDP probe`);
        probe.close();
        resolve(true);
      });

      probe.on("error", (err) => {
        logger.warn(`[PROBE] Probe socket error: ${err.message}`);
        if (!responded) resolve(false);
      });

      // Send a minimal ENet CONNECT (44 bytes: peerID + sentTime + CONNECT command)
      const buf = Buffer.alloc(44);
      buf.writeUInt16BE(0x8FFF, 0);  // peerID=0xFFF with sentTime flag
      buf.writeUInt16BE(0, 2);        // sentTime=0
      buf[4] = 0x82;                  // CONNECT | ACK flag
      buf[5] = 0xFF;                  // channelID
      buf.writeUInt16BE(1, 6);        // reliableSeqNum=1
      // connect data (36 bytes) — MTU=1400
      buf.writeUInt32BE(1400, 12);    // MTU
      buf.writeUInt32BE(32768, 16);   // windowSize
      buf.writeUInt32BE(2, 20);       // channelCount
      // bytes 24-43: bandwidths, throttle, connectID = 0 (fine for probe)

      probe.send(buf, port, host, (err) => {
        if (err) {
          logger.warn(`[PROBE] Failed to send probe to ${host}:${port}: ${err.message}`);
          resolve(false);
          return;
        }
        logger.info(`[PROBE] Sent UDP probe (44b) to ${host}:${port} — waiting 5s for response...`);
      });

      // Give it 5 seconds
      setTimeout(() => {
        if (!responded) {
          logger.warn(`[PROBE] ✗ No UDP response from ${host}:${port} after 5s`);
          logger.warn(`[PROBE] This confirms the GT server is not accepting ENet connections`);
          logger.warn(`[PROBE] (likely maintenance mode — #maint was in server_data)`);
          try { probe.close(); } catch (e) {}
          resolve(false);
        }
      }, 5000);
    });
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

    if (session.noResponseTimer) clearTimeout(session.noResponseTimer);

    // Close the per-session server socket
    if (session.serverSocket) {
      try { session.serverSocket.close(); } catch (e) {}
    }

    this.sessions.delete(clientKey);
    this.commandHandler.clearUserState(session.clientId);

    gameLog.logPackets(this.totalClientPackets, this.totalServerPackets);
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
loginServer.gameLog = gameLog;

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
logger.info(`Game log: ${gameLog.logPath}`);
if (process.stdin.isTTY) {
  process.stdin.resume();
}

} catch (err) {
  // This catches require() failures and any synchronous startup errors
  console.error(`\n[FATAL] Startup failed: ${err.message}\n${err.stack}`);
  pauseBeforeExit("\nPress ENTER to exit...").then(() => process.exit(1));
}
