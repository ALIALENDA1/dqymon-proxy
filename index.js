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

const enet = require("enet");
const config = require("./config/config");
const PacketHandler = require("./handlers/PacketHandler");
const CommandHandler = require("./handlers/CommandHandler");
const Logger = require("./utils/Logger");
const LoginServer = require("./utils/LoginServer");
const GameLauncher = require("./utils/GameLauncher");

const logger = new Logger();

class GrowtopiaProxy {
  constructor() {
    this.sessions = new Map();    // clientId -> { clientPeer, serverHost, serverPeer, pendingServer }
    this.peerToClient = new Map(); // peer pointer -> clientId
    this.packetHandler = new PacketHandler();
    this.commandHandler = new CommandHandler(this);
    this.proxyHost = null;
    this.loginServer = null;       // set after construction
  }

  start() {
    const addr = new enet.Address({
      address: config.proxy.host,
      port: config.proxy.port,
    });

    this.proxyHost = enet.createServer(
      {
        address: addr,
        peers: config.proxy.maxPeers || 32,
        channels: config.proxy.channels || 2,
        down: 0,
        up: 0,
      },
      (err, host) => {
        if (err) {
          logger.error(`Failed to start ENet server: ${err.message || err}`);
          return;
        }

        logger.info(
          `✓ ENet proxy started on ${config.proxy.host}:${config.proxy.port}`
        );

        // Incoming client connection
        host.on("connect", (clientPeer) => {
          const clientId = this.generateClientId();
          logger.info(`[CLIENT] New ENet connection: ${clientId}`);

          this.peerToClient.set(clientPeer._pointer, clientId);
          this.sessions.set(clientId, { clientPeer, serverHost: null, serverPeer: null, pendingServer: null });

          // Create a separate ENet client host to connect to the real GT server
          this.connectToServer(clientId);
        });

        // Client disconnected
        host.on("disconnect", (clientPeer) => {
          const clientId = this.peerToClient.get(clientPeer._pointer);
          if (!clientId) return;
          logger.info(`[CLIENT] Disconnected: ${clientId}`);
          this.cleanup(clientId);
        });

        // Incoming data from a client
        host.on("message", (clientPeer, packet, channelId) => {
          const clientId = this.peerToClient.get(clientPeer._pointer);
          if (!clientId) return;

          const data = packet.data();

          if (config.logging.enabled) {
            logger.debug(
              `[${clientId}] Client -> Server (ch${channelId}): ${data.length} bytes`
            );
          }

          // Process commands / modify packet
          const processedData = this.handleClientData(clientId, data);

          // Forward to real GT server
          const session = this.sessions.get(clientId);
          if (processedData && session && session.serverPeer) {
            const fwdPacket = new enet.Packet(processedData, enet.PACKET_FLAG.RELIABLE);
            session.serverPeer.send(channelId, fwdPacket);
          }
        });

        host.start(10); // Service every 10ms
      }
    );
  }

  /**
   * Create an ENet client that connects to the real Growtopia server
   * and relays traffic back to the game client.
   */
  connectToServer(clientId) {
    const session = this.sessions.get(clientId);
    if (!session) return;

    // Use pending sub-server redirect, then login response, then static config.
    let serverHost, serverPort;
    if (session.pendingServer) {
      serverHost = session.pendingServer.host;
      serverPort = session.pendingServer.port;
      session.pendingServer = null; // consume it
    } else if (this.loginServer && this.loginServer.realServerHost) {
      serverHost = this.loginServer.realServerHost;
      serverPort = this.loginServer.realServerPort;
    } else {
      serverHost = config.serverConfig.host;
      serverPort = config.serverConfig.port;
    }

    logger.info(`[${clientId}] Connecting to real GT server at ${serverHost}:${serverPort}`);

    const serverHostEnet = enet.createClient(
      {
        peers: 1,
        channels: config.serverConfig.channels || 2,
        down: 0,
        up: 0,
      },
      (err, host) => {
        if (err) {
          logger.error(
            `[${clientId}] Failed to create ENet client: ${err.message || err}`
          );
          this.cleanup(clientId);
          return;
        }

        session.serverHost = host;

        const serverAddr = new enet.Address({
          address: serverHost,
          port: serverPort,
        });

        const serverPeer = host.connect(
          serverAddr,
          config.serverConfig.channels || 2,
          0,
          (err, peer) => {
            if (err) {
              logger.error(
                `[${clientId}] Failed to connect to GT server at ${serverHost}:${serverPort}: ${err.message || err}`
              );
              this.cleanup(clientId);
              return;
            }

            logger.info(`[${clientId}] Connected to GT server`);
            session.serverPeer = peer;

            // Send in-game status to client
            this.sendStatus(clientId);
          }
        );

        // Data from GT server -> relay to client
        host.on("message", (serverPeer, packet, channelId) => {
          const data = packet.data();

          if (config.logging.enabled) {
            logger.debug(
              `[${clientId}] Server -> Client (ch${channelId}): ${data.length} bytes`
            );
          }

          // Modify server response if needed
          const modifiedData = this.handleServerData(clientId, data);

          if (modifiedData && session.clientPeer) {
            const fwdPacket = new enet.Packet(
              modifiedData,
              enet.PACKET_FLAG.RELIABLE
            );
            session.clientPeer.send(channelId, fwdPacket);
          }
        });

        // Server disconnected
        serverPeer.on("disconnect", () => {
          logger.info(`[${clientId}] GT server disconnected`);
          this.cleanup(clientId);
        });

        host.start(10);
      }
    );
  }

  handleClientData(clientId, data) {
    // Check for commands only in text-type packets
    // Growtopia text packets (type 2/3) have ASCII content after a 4-byte header
    if (data.length < 4) return data;

    const msgType = data.readUInt32LE(0);

    // Only check for commands in text packets (type 2 = login info, type 3 = action/text)
    if (msgType === 2 || msgType === 3) {
      const text = data.toString("utf8", 4, Math.min(data.length, 260));
      const prefix = config.commands.prefix;

      // Match command pattern: either direct "/command" or Growtopia chat format "|text|/command"
      if (
        text.startsWith(prefix) ||
        text.includes(`|text|${prefix}`)
      ) {
        const result = this.commandHandler.execute(clientId, text);
        if (result.handled) {
          logger.info(`[${clientId}] Command executed: ${result.command}`);
          return result.data;
        }
      }
    }

    return data; // Pass through
  }

  handleServerData(clientId, data) {
    let modifiedData = data;

    // Intercept OnSendToServer variant (sub-server redirect)
    // The real GT server sends this to tell client to disconnect
    // and reconnect to a different server IP:port.
    // We need to rewrite it so the client reconnects to our proxy,
    // and we store the real target to connect on their behalf.
    if (data.length > 60) {
      try {
        const msgType = data.readUInt32LE(0);
        if (msgType === 4) { // TANK packet
          const tankType = data.readUInt32LE(4);
          if (tankType === 1) { // CALL_FUNCTION
            const extraDataSize = data.readUInt32LE(56);
            if (extraDataSize > 0 && data.length >= 60 + extraDataSize) {
              const extraData = data.slice(60);
              // Try to read variant function name
              const varCount = extraData.readUInt8(0);
              if (varCount > 0) {
                // First variant: index(1) + type(1) + string
                let offset = 1; // skip count byte
                const idx0 = extraData.readUInt8(offset); offset += 1;
                const type0 = extraData.readUInt8(offset); offset += 1;
                if (type0 === 2 && offset + 4 <= extraData.length) { // string
                  const strLen = extraData.readUInt32LE(offset); offset += 4;
                  if (offset + strLen <= extraData.length) {
                    const funcName = extraData.toString("utf8", offset, offset + strLen);
                    offset += strLen;

                    if (funcName === "OnSendToServer") {
                      // Parse all variants: [0]=funcName, [1]=port, [2]=token, [3]=user, [4]=address
                      logger.info(`[${clientId}] Intercepted OnSendToServer`);

                      let realPort = 17091;
                      let realToken = 0;
                      let realUser = 0;
                      let realAddress = null;
                      let addressFull = "127.0.0.1|0|";

                      try {
                        let off2 = 1; // skip variant count byte
                        for (let vi = 0; vi < varCount && off2 < extraData.length; vi++) {
                          const vIdx = extraData.readUInt8(off2); off2 += 1;
                          const vType = extraData.readUInt8(off2); off2 += 1;
                          if (vType === 1) { off2 += 4; } // float
                          else if (vType === 2) { // string
                            const sLen = extraData.readUInt32LE(off2); off2 += 4;
                            if (vIdx === 4) {
                              addressFull = extraData.toString("utf8", off2, off2 + sLen);
                              realAddress = addressFull.split("|")[0]; // "IP|doorId|uuid" → IP
                            }
                            off2 += sLen;
                          }
                          else if (vType === 3) { off2 += 8; } // vec2
                          else if (vType === 4) { off2 += 12; } // vec3
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
                        logger.info(`[${clientId}] Sub-server redirect: ${realAddress}:${realPort} (token=${realToken}, user=${realUser})`);
                        // Store per-session for the next connectToServer call
                        const session = this.sessions.get(clientId);
                        if (session) {
                          session.pendingServer = { host: realAddress, port: realPort };
                        }
                      }

                      // Rewrite: redirect client to our proxy, but preserve token + user
                      const proxyHost = config.proxy.host === "0.0.0.0" ? "127.0.0.1" : config.proxy.host;
                      // Replace only the IP in the address string, keep doorId and uuid
                      const addrParts = addressFull.split("|");
                      addrParts[0] = proxyHost;
                      const rewrittenAddr = addrParts.join("|");

                      modifiedData = PacketHandler.buildVariantPacket([
                        { type: 2, value: "OnSendToServer" },
                        { type: 9, value: config.proxy.port },     // port → proxy
                        { type: 9, value: realToken },              // preserve real token
                        { type: 9, value: realUser },               // preserve real user
                        { type: 2, value: rewrittenAddr },          // address → proxy, keep doorId/uuid
                      ], -1, 0);

                      return modifiedData;
                    }
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        // Failed to parse — pass through unmodified
      }
    }

    if (config.cheats.freeOutfit) {
      modifiedData = this.packetHandler.injectItems(modifiedData, clientId);
    }

    return modifiedData;
  }

  /**
   * Send a raw packet buffer to a client peer.
   */
  sendToClient(clientId, data) {
    const session = this.sessions.get(clientId);
    if (!session || !session.clientPeer) return;
    try {
      const pkt = new enet.Packet(data, enet.PACKET_FLAG.RELIABLE);
      session.clientPeer.send(0, pkt);
    } catch (err) {
      logger.debug(`[${clientId}] sendToClient failed: ${err.message}`);
    }
  }

  /**
   * Show in-game proxy status to the player.
   */
  sendStatus(clientId) {
    // Console message (chat box)
    const consoleMsg = PacketHandler.buildConsoleMessage(
      "`4[`#dqymon-proxy`4]`` `2Connected to proxy!``"
    );
    this.sendToClient(clientId, consoleMsg);

    // Text overlay (big centered text, fades out)
    const overlay = PacketHandler.buildTextOverlay(
      "`4dqymon-proxy `2active``"
    );
    this.sendToClient(clientId, overlay);
  }

  cleanup(clientId) {
    const session = this.sessions.get(clientId);
    if (!session) return;

    if (session.clientPeer) {
      try { session.clientPeer.reset(); } catch (e) { /* already gone */ }
    }
    if (session.serverPeer) {
      try { session.serverPeer.reset(); } catch (e) { /* already gone */ }
    }
    if (session.serverHost) {
      try { session.serverHost.destroy(); } catch (e) { /* already gone */ }
    }

    // Clean up maps
    if (session.clientPeer) {
      this.peerToClient.delete(session.clientPeer._pointer);
    }
    this.sessions.delete(clientId);
    this.commandHandler.clearUserState(clientId);

    logger.info(`[${clientId}] Session cleaned up`);
  }

  generateClientId() {
    return Math.random().toString(36).substring(2, 11);
  }

  getSession(clientId) {
    return this.sessions.get(clientId);
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
  gameLauncher.cleanup();
  loginServer.stop();
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(); });
process.on("SIGTERM", () => { cleanup(); process.exit(); });

// 1. Start the ENet proxy
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
