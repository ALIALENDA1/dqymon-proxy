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
const GameEventLogger = require("./utils/GameEventLogger");

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
    this.gameEventLogger = new GameEventLogger();
    this.clientSocket = null;      // Receives from Growtopia client (port 17091)
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
    // ── Single UDP socket (port 17091) ──
    // Handles BOTH client and server traffic on the same port.
    // Client sends here (127.0.0.1:17091), and we also send to the
    // GT server FROM this port. This avoids firewall/NAT issues with
    // ephemeral ports — responses come back to the same port.
    this.clientSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    this.clientSocket.on("message", (msg, rinfo) => {
      const clientKey = `${rinfo.address}:${rinfo.port}`;

      // IMPORTANT: Check known clients FIRST to prevent wildcard server
      // matching from capturing client packets (which would reflect them
      // back to the client instead of forwarding to the GT server).
      if (this.sessions.has(clientKey)) {
        this.handleClientPacket(this.sessions.get(clientKey), msg, rinfo);
        return;
      }

      // Check if this is a GT server response
      const serverSession = this.findSessionForServerResponse(rinfo);
      if (serverSession) {
        this.handleServerMessage(serverSession, msg, rinfo);
        return;
      }

      // New client connection
      this.createSession(clientKey, rinfo);
      this.handleClientPacket(this.sessions.get(clientKey), msg, rinfo);
    });

    this.clientSocket.on("error", (err) => {
      logger.error(`Socket error: ${err.message}`);
    });

    this.clientSocket.on("close", () => {
      logger.warn("Socket closed unexpectedly");
    });

    this.clientSocket.bind(config.proxy.port, config.proxy.host, () => {
      logger.info(
        `✓ Listening on ${config.proxy.host}:${config.proxy.port} (single socket mode)`
      );
      if (this.spoofState.enabled) {
        logger.info(`✓ Spoofing: MAC=${this.spoofState.mac} RID=${this.spoofState.rid.substring(0, 8)}...`);
      }
    });

    // Periodically clean up stale sessions
    setInterval(() => this.cleanupStaleSessions(), 15000);
  }

  /**
   * Find a session matching a GT server response.
   */
  findSessionForServerResponse(rinfo) {
    // Strategy 1: Exact IP:port match
    for (const session of this.sessions.values()) {
      if (rinfo.address === session.serverHost && rinfo.port === session.serverPort) {
        return session;
      }
    }

    // Strategy 2: IP-only match (server might respond from a different port)
    for (const session of this.sessions.values()) {
      if (rinfo.address === session.serverHost) {
        if (session.serverPackets === 0) {
          logger.info(
            `[${session.clientId}] Matched server by IP (port ${rinfo.port}, expected ${session.serverPort})`
          );
        }
        return session;
      }
    }

    // Strategy 3: Wildcard — if one session, accept any non-client packet
    if (this.sessions.size === 1) {
      const session = this.sessions.values().next().value;
      // Guard: never match the session's own client address
      if (rinfo.address === session.clientAddr && rinfo.port === session.clientPort) {
        return null;
      }
      if (session.serverPackets === 0) {
        logger.info(
          `[${session.clientId}] Matched server by wildcard (${rinfo.address}:${rinfo.port})`
        );
      }
      return session;
    }

    return null;
  }

  /**
   * Handle a client packet — forward to GT server.
   */
  handleClientPacket(session, msg, rinfo) {
    session.lastActivity = Date.now();
    session.clientPackets = (session.clientPackets || 0) + 1;
    this.totalClientPackets++;

    // Log first few packets and then periodically
    if (session.clientPackets <= 10 || session.clientPackets % 50 === 0) {
      logger.info(
        `[${session.clientId}] Client → Server: ${msg.length} bytes (pkt #${session.clientPackets})`
      );
    }

    // Detailed ENet diagnostic for the first few packets to learn the format
    if (session.clientPackets <= 5) {
      this.logENetDiagnostic(session, msg, "C→S");
    }

    // Run the mirror test on the FIRST packet only
    if (session.clientPackets === 1) {
      this.mirrorTest(session, msg);
    }

    // Inspect and possibly modify Growtopia payloads (MAC spoofing, etc.)
    const modified = this.inspectClientDatagram(session, msg);

    // Forward to GT server from the SAME socket (port 17091).
    // Single-socket avoids firewall/NAT blocking on ephemeral ports.
    this.clientSocket.send(
      modified, 0, modified.length,
      session.serverPort, session.serverHost,
      (err) => {
        if (err) {
          logger.error(`[${session.clientId}] Send to GT server failed: ${err.message}`);
        } else if (session.clientPackets <= 3) {
          logger.info(
            `[${session.clientId}] ✓ Sent ${modified.length}b to ` +
            `${session.serverHost}:${session.serverPort} from :${config.proxy.port}`
          );
        }
      }
    );
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
        `[${session.clientId}] Response from ${rinfo.address}:${rinfo.port} (${msg.length}b)`
      );
      gameLog.logConnectionSuccess(
        session.clientId,
        `${session.serverHost}:${session.serverPort}`
      );
    }

    // Log first few packets and then periodically
    if (session.serverPackets <= 10 || session.serverPackets % 50 === 0) {
      logger.info(
        `[${session.clientId}] Server → Client: ${msg.length} bytes (pkt #${session.serverPackets})`
      );
    }

    // Log detailed format info for first few server packets
    if (session.serverPackets <= 5) {
      this.logENetDiagnostic(session, msg, "S→C");
    }

    // Inspect/modify server-to-client traffic (OnSendToServer, etc.)
    const modified = this.inspectServerDatagram(session, msg);

    // Relay back to the game client via the CLIENT socket (port 17091)
    this.clientSocket.send(
      modified, 0, modified.length,
      session.clientPort, session.clientAddr,
      (err) => {
        if (err && err.code !== "ERR_SOCKET_DGRAM_NOT_RUNNING") {
          logger.error(`[${session.clientId}] Failed to send to client: ${err.message}`);
        }
      }
    );
  }

  /**
   * Create a new session for a client.
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

    const session = {
      clientId,
      clientAddr: rinfo.address,
      clientPort: rinfo.port,
      serverHost,
      serverPort,
      lastActivity: Date.now(),
      clientPackets: 0,
      serverPackets: 0,
    };

    this.sessions.set(clientKey, session);
    logger.info(`[${clientId}] New session: ${clientKey} → ${serverHost}:${serverPort}`);
    gameLog.logConnection(clientId, `${serverHost}:${serverPort}`);

    // Info maintenance (not a warning — server may still accept connections)
    if (this.loginServer && this.loginServer.maintenanceDetected) {
      logger.info(`[${clientId}] Note: server_data had #maint flag`);
    }

    // Warn if GT server never responds after 15 seconds
    session.noResponseTimer = setTimeout(() => {
      if (!this.sessions.has(clientKey)) return; // session already cleaned up
      if (!session.serverPackets) {
        logger.error(
          `[${clientId}] ✗ GT server ${serverHost}:${serverPort} did NOT respond after 15s`
        );
        logger.error(
          `[${clientId}] ✗ Sent ${session.clientPackets} packets, received 0 back`
        );
        if (this.loginServer && this.loginServer.maintenanceDetected) {
          logger.warn(
            `[${clientId}] Note: server_data had #maint flag (may not prevent connections)`
          );
        }
        logger.error(
          `[${clientId}] ✗ Run dqymon-diagnose.exe relay test to check if your machine can relay UDP`
        );
        gameLog.logConnectionFail(
          clientId,
          `${serverHost}:${serverPort}`,
          `No response after 15s (sent ${session.clientPackets} pkts)`
        );
      }
    }, 15000);
  }

  // ── Reachability Testing ─────────────────────────────────────────

  /**
   * MIRROR TEST: Send the exact same raw bytes from a completely fresh
   * ephemeral socket. This eliminates ALL proxy-specific variables
   * (port, socket config, firewall rules) and tells us definitively
   * whether the GT server is accepting ENet connections RIGHT NOW.
   *
   * - If mirror gets response but relay doesn't → proxy socket issue
   * - If NEITHER gets response → GT server is down/unreachable
   * - If BOTH get response → everything works (shouldn't happen if relay failed)
   */
  mirrorTest(session, rawPacket) {
    logger.info(`[MIRROR] Starting reachability test for ${session.serverHost}:${session.serverPort}`);

    const testSocket = dgram.createSocket("udp4");
    let responded = false;

    testSocket.on("message", (msg, rinfo) => {
      responded = true;
      logger.info(`[MIRROR] ✓✓✓ GT server RESPONDED! from ${rinfo.address}:${rinfo.port} (${msg.length}b)`);
      logger.info(`[MIRROR] ✓ Server IS accepting ENet connections right now`);
      logger.info(`[MIRROR] ✓ If the main relay isn't working, it's a port/firewall issue`);

      const hex = msg.slice(0, Math.min(msg.length, 32)).toString("hex").match(/.{1,2}/g).join(" ");
      logger.info(`[MIRROR] Response hex: ${hex}`);

      gameLog.logEvent("MIRROR TEST: Server responded! Server is UP.");
      try { testSocket.close(); } catch {}
    });

    testSocket.on("error", (err) => {
      logger.warn(`[MIRROR] Test socket error: ${err.message}`);
    });

    // Send the EXACT same raw bytes the game client sent
    testSocket.send(rawPacket, session.serverPort, session.serverHost, (err) => {
      if (err) {
        logger.warn(`[MIRROR] Send failed: ${err.message}`);
        return;
      }
      try {
        const addr = testSocket.address();
        logger.info(`[MIRROR] Sent ${rawPacket.length}b to ${session.serverHost}:${session.serverPort} from :${addr.port}`);
      } catch (e) {
        logger.info(`[MIRROR] Sent ${rawPacket.length}b`);
      }
    });

    // Wait 10 seconds for response
    setTimeout(() => {
      if (!responded) {
        logger.warn(`[MIRROR] ✗ No response from mirror test after 10s`);
        logger.warn(`[MIRROR] ✗ Our crafted packet may not match GT's custom ENet format.`);
        logger.warn(`[MIRROR] ✗ This does NOT prove the server is down.`);
        logger.warn(`[MIRROR] ✗ Run dqymon-diagnose.exe relay test for a definitive answer.`);
        gameLog.logEvent("MIRROR TEST: No response (crafted packet may not match GT format).");
      }
      try { testSocket.close(); } catch {}
    }, 10000);
  }

  // ── ENet diagnostics ─────────────────────────────────────────────

  /**
   * CRC32 implementation matching ENet's polynomial (0xEDB88320).
   */
  static crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /**
   * Parse and log detailed information about an ENet packet.
   * Tries multiple header formats to detect GT's custom ENet variant.
   * @param {object} session
   * @param {Buffer} buf
   * @param {string} direction - "C→S" or "S→C"
   */
  logENetDiagnostic(session, buf, direction = "") {
    const dirTag = direction ? ` ${direction}` : "";
    const hex = buf.slice(0, Math.min(buf.length, 80)).toString("hex").match(/.{1,2}/g).join(" ");
    logger.debug(`[${session.clientId}]${dirTag} Raw (${buf.length}b): ${hex}`);

    if (buf.length < 4) return;

    const peerIDField = buf.readUInt16BE(0);
    const hasSentTime = !!(peerIDField & 0x8000);
    const isCompressed = !!(peerIDField & 0x4000);
    const rawPeerID = peerIDField & 0x0FFF;

    if (isCompressed) {
      logger.debug(`[${session.clientId}]${dirTag} Compressed datagram — forwarded as-is`);
      return;
    }

    // ── Try all possible header layouts ────────────────────────────
    // GT uses a modified ENet. We try every combination of sentTime and
    // checksum position to find a layout where the command byte is valid
    // and (if checksum is present) the CRC32 matches.
    const layouts = [];

    // Standard: flags from peerID field
    const baseOffset = 2 + (hasSentTime ? 2 : 0);
    layouts.push({ name: "std", cmdOffset: baseOffset, crcOffset: -1 });
    layouts.push({ name: "std+crc", cmdOffset: baseOffset + 4, crcOffset: baseOffset });

    // Force sentTime ON (GT might always include sentTime regardless of flag)
    if (!hasSentTime) {
      layouts.push({ name: "forceST", cmdOffset: 4, crcOffset: -1 });
      layouts.push({ name: "forceST+crc", cmdOffset: 8, crcOffset: 4 });
    }

    const cmdNames = {
      1: "ACK", 2: "CONNECT", 3: "VERIFY_CONNECT", 4: "DISCONNECT",
      5: "PING", 6: "SEND_RELIABLE", 7: "SEND_UNRELIABLE", 8: "SEND_FRAGMENT",
      9: "SEND_UNSEQUENCED", 10: "BW_LIMIT", 11: "THROTTLE", 12: "SEND_UNRELIABLE_FRAG",
    };

    let bestParse = null;

    for (const layout of layouts) {
      if (layout.cmdOffset >= buf.length) continue;

      const cmdByte = buf[layout.cmdOffset];
      const cmdType = cmdByte & 0x0F;
      if (cmdType < 1 || cmdType > 12) continue;

      const cmdName = cmdNames[cmdType];
      let crcOk = null;

      if (layout.crcOffset >= 0 && layout.crcOffset + 4 <= buf.length) {
        const stored = buf.readUInt32LE(layout.crcOffset);
        const testBuf = Buffer.from(buf);
        testBuf.writeUInt32LE(0, layout.crcOffset);
        const computed = GrowtopiaProxy.crc32(testBuf);
        crcOk = stored === computed;
      }

      const quality = (crcOk === true ? 2 : 0) + (cmdType >= 1 && cmdType <= 12 ? 1 : 0);
      if (!bestParse || quality > bestParse.quality) {
        bestParse = { layout: layout.name, cmdByte, cmdType, cmdName, crcOk, quality, cmdOffset: layout.cmdOffset };
      }
    }

    if (bestParse) {
      const crcStr = bestParse.crcOk === true ? "CRC32✓" : bestParse.crcOk === false ? "CRC32✗" : "no-CRC";
      logger.debug(
        `[${session.clientId}]${dirTag} Parse: [${bestParse.layout}] ` +
        `cmd=0x${bestParse.cmdByte.toString(16)}→${bestParse.cmdName} (${crcStr})`
      );

      // For data-carrying commands, try to extract the GT payload
      if ((bestParse.cmdType === 6 || bestParse.cmdType === 7) && buf.length > bestParse.cmdOffset + 6) {
        const dataLenOffset = bestParse.cmdType === 6 ? bestParse.cmdOffset + 4 : bestParse.cmdOffset + 6;
        if (dataLenOffset + 2 <= buf.length) {
          const dataLen = buf.readUInt16BE(dataLenOffset);
          const dataStart = dataLenOffset + 2;
          if (dataStart + 4 <= buf.length) {
            const gtType = buf.readUInt32LE(dataStart);
            logger.info(
              `[${session.clientId}]${dirTag} GT payload: type=${gtType} ` +
              `(${gtType === 1 ? "HELLO" : gtType === 2 ? "LOGIN" : gtType === 3 ? "TEXT" : gtType === 4 ? "TANK" : "?"}) ` +
              `len=${dataLen}b`
            );

            // Dump first 120 chars of text for types 2 and 3
            if ((gtType === 2 || gtType === 3) && dataStart + 4 < buf.length) {
              const textPart = buf.toString("utf8", dataStart + 4, Math.min(buf.length, dataStart + 4 + 120));
              logger.debug(`[${session.clientId}]${dirTag} Text: ${textPart.replace(/[\r\n]/g, "\\n").substring(0, 120)}`);
            }
          }
        }
      }
    } else {
      logger.debug(
        `[${session.clientId}]${dirTag} Unknown ENet format — bytes forwarded as-is`
      );
    }

    // ── Scan for GT packet signatures in raw bytes ────────────────
    // Even if we can't parse the ENet header, look for known GT
    // payload patterns anywhere in the packet to help reverse-engineer
    // the format. Only log for first 3 packets to avoid spam.
    if ((session.clientPackets || 0) + (session.serverPackets || 0) <= 6) {
      this.scanForGTSignatures(session, buf, dirTag);
    }
  }

  /**
   * Scan raw bytes for known Growtopia payload signatures.
   * This works regardless of the ENet header format — it looks for
   * known byte patterns in the raw UDP datagram to help us understand
   * where the GT payload starts.
   */
  scanForGTSignatures(session, buf, dirTag) {
    // Look for known text patterns that appear in GT login/text packets
    const signatures = [
      { pattern: "tankIDName", desc: "LOGIN" },
      { pattern: "requestedName", desc: "LOGIN" },
      { pattern: "action|", desc: "ACTION" },
      { pattern: "OnSendToServer", desc: "REDIRECT" },
      { pattern: "OnConsoleMessage", desc: "CONSOLE" },
      { pattern: "OnSpawn", desc: "SPAWN" },
    ];

    const text = buf.toString("utf8", 0, Math.min(buf.length, 4096));
    for (const sig of signatures) {
      const idx = text.indexOf(sig.pattern);
      if (idx !== -1) {
        logger.info(
          `[${session.clientId}]${dirTag} ✓ Found "${sig.pattern}" at offset ${idx} (${sig.desc})`
        );
        // Check for GT type header (uint32LE) 4 bytes before the text
        if (idx >= 4) {
          const possibleType = buf.readUInt32LE(idx - 4);
          if (possibleType >= 1 && possibleType <= 10) {
            logger.info(
              `[${session.clientId}]${dirTag} ✓ GT type=${possibleType} at offset ${idx - 4} — ` +
              `ENet payload likely starts at offset ${idx - 4}`
            );
          }
        }
      }
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
   * May MODIFY the datagram (e.g. MAC spoofing on login packets).
   * Returns the (possibly modified) datagram buffer.
   */
  inspectClientDatagram(session, buf) {
    try {
      const payloads = ENetParser.extractPayloads(buf);
      for (const { cmd, data } of payloads) {
        const modified = this.handleClientPayload(session, data);
        if (modified && modified !== data) {
          // Replace this payload in the ENet datagram
          return ENetParser.replacePayload(buf, cmd, modified);
        }
      }
    } catch (e) {
      // Parsing failed — just relay unmodified
    }
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
   * Handles: login spoofing (type 2), command detection (type 3),
   * action logging (type 3), and TANK events (type 4).
   * Returns modified payload Buffer if changed, or original.
   */
  handleClientPayload(session, data) {
    if (data.length < 4) return data;

    const msgType = data.readUInt32LE(0);

    // Type 2 = login info — spoof device fingerprints
    if (msgType === 2) {
      return this.spoofLoginInfo(session, data);
    }

    // Type 3 = action/text — log actions and check commands
    if (msgType === 3) {
      const text = data.toString("utf8", 4, Math.min(data.length, 2048)).replace(/\0+$/, "");
      const prefix = config.commands.prefix;

      // Log the client action (world join, drop, chat, etc.)
      this.gameEventLogger.processClientAction(text);

      if (text.startsWith(prefix) || text.includes(`|text|${prefix}`)) {
        const result = this.commandHandler.execute(session.clientId, text);
        if (result.handled) {
          logger.info(`[${session.clientId}] Command executed: ${result.command}`);
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

    // Log server text packets (type 2 / type 3)
    if (msgType === 2 || msgType === 3) {
      const text = data.toString("utf8", 4, Math.min(data.length, 2048)).replace(/\0+$/, "");
      if (text.trim()) {
        logger.debug(`[${session.clientId}] Server text (type ${msgType}): ${text.substring(0, 120)}`);
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
    this.gameEventLogger.processVariantCall(variants, session.clientId);

    // Handle OnSendToServer — rewrite target to proxy
    const funcName = (variants[0] && variants[0].type === 2) ? variants[0].value : "";
    if (funcName !== "OnSendToServer") return data;

    logger.info(`[${session.clientId}] Intercepted OnSendToServer`);

    let realPort = 17091;
    let realToken = 0;
    let realUser = 0;
    let realAddress = null;
    let addressFull = "127.0.0.1|0|";

    for (const v of variants) {
      if (v.index === 1 && (v.type === 5 || v.type === 9)) realPort = v.value;
      if (v.index === 2 && (v.type === 5 || v.type === 9)) realToken = v.value;
      if (v.index === 3 && (v.type === 5 || v.type === 9)) realUser = v.value;
      if (v.index === 4 && v.type === 2) {
        addressFull = v.value;
        realAddress = addressFull.split("|")[0];
      }
    }

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
