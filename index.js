// ── Keep the window open on any crash ──────────────────────────────────
function waitForKey(msg) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve();
    process.stdout.write(msg);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}

process.on("uncaughtException", async (err) => {
  console.error(`\n[FATAL] ${err.message}\n${err.stack}`);
  await waitForKey("\nPress any key to exit...");
  process.exit(1);
});

process.on("unhandledRejection", async (err) => {
  console.error(`\n[FATAL] Unhandled rejection: ${err}`);
  await waitForKey("\nPress any key to exit...");
  process.exit(1);
});
// ────────────────────────────────────────────────────────────────────────

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
    this.sessions = new Map();    // clientId -> { clientPeer, serverHost, serverPeer }
    this.peerToClient = new Map(); // peer pointer -> clientId
    this.packetHandler = new PacketHandler();
    this.commandHandler = new CommandHandler(this);
    this.proxyHost = null;
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
        logger.info(
          `✓ Forwarding to ${config.serverConfig.host}:${config.serverConfig.port}`
        );

        // Incoming client connection
        host.on("connect", (clientPeer, data, outgoing) => {
          if (outgoing) return; // Ignore our own outgoing connections

          const clientId = this.generateClientId();
          logger.info(`[CLIENT] New ENet connection: ${clientId}`);

          this.peerToClient.set(clientPeer._pointer, clientId);
          this.sessions.set(clientId, { clientPeer, serverHost: null, serverPeer: null });

          // Create a separate ENet client host to connect to the real GT server
          this.connectToServer(clientId);
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

    const serverHost = enet.createClient(
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
          address: config.serverConfig.host,
          port: config.serverConfig.port,
        });

        const serverPeer = host.connect(
          serverAddr,
          config.serverConfig.channels || 2,
          0,
          (err, peer) => {
            if (err) {
              logger.error(
                `[${clientId}] Failed to connect to GT server: ${err.message || err}`
              );
              this.cleanup(clientId);
              return;
            }

            logger.info(`[${clientId}] Connected to GT server`);
            session.serverPeer = peer;
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
        host.on("connect", (peer, data, outgoing) => {
          if (outgoing) {
            // Our connection to the server succeeded (already handled in connect callback)
          }
        });

        serverPeer.on("disconnect", () => {
          logger.info(`[${clientId}] GT server disconnected`);
          // Disconnect the client too
          if (session.clientPeer) {
            session.clientPeer.disconnectLater(0);
          }
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

    if (config.cheats.freeOutfit) {
      modifiedData = this.packetHandler.injectItems(modifiedData, clientId);
    }

    return modifiedData;
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

// 3. Redirect Growtopia domains to 127.0.0.1 & launch the game
if (config.game && config.game.modifyHosts !== false) {
  gameLauncher.modifyHosts();
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
