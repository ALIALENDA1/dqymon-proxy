const net = require("net");
const config = require("../config/config");
const PacketHandler = require("./handlers/PacketHandler");
const CommandHandler = require("./handlers/CommandHandler");
const Logger = require("./utils/Logger");

const logger = new Logger();

class GrowtopiaProxy {
  constructor() {
    this.clientSockets = new Map();
    this.serverSockets = new Map();
    this.packetHandler = new PacketHandler();
    this.commandHandler = new CommandHandler(this);
  }

  start() {
    const server = net.createServer((clientSocket) => {
      const clientId = this.generateClientId();
      logger.info(`[CLIENT] New connection: ${clientId}`);

      // Connect to Growtopia server
      const serverSocket = net.createConnection(
        config.serverConfig.port,
        config.serverConfig.host
      );

      this.clientSockets.set(clientId, clientSocket);
      this.serverSockets.set(clientId, serverSocket);

      // Client -> Server (Player to GT Server)
      clientSocket.on("data", (data) => {
        if (config.logging.enabled) {
          logger.debug(`[${clientId}] Client -> Server: ${data.length} bytes`);
        }

        // Parse & handle local commands
        const processedData = this.handleClientData(clientId, data);

        // Forward to actual Growtopia server
        if (processedData && serverSocket.writable) {
          serverSocket.write(processedData);
        }
      });

      // Server -> Client (GT Server to Player)
      serverSocket.on("data", (data) => {
        if (config.logging.enabled) {
          logger.debug(`[${clientId}] Server -> Client: ${data.length} bytes`);
        }

        // Modify server response (inject items, etc)
        const modifiedData = this.handleServerData(clientId, data);

        // Send back to client
        if (modifiedData && clientSocket.writable) {
          clientSocket.write(modifiedData);
        }
      });

      // Handle disconnections
      clientSocket.on("end", () => {
        logger.info(`[CLIENT] Disconnected: ${clientId}`);
        this.cleanup(clientId);
      });

      serverSocket.on("end", () => {
        logger.info(`[SERVER] Disconnected: ${clientId}`);
        this.cleanup(clientId);
      });

      clientSocket.on("error", (err) => {
        logger.error(`[CLIENT] Error: ${clientId} - ${err.message}`);
        this.cleanup(clientId);
      });

      serverSocket.on("error", (err) => {
        logger.error(`[SERVER] Error: ${clientId} - ${err.message}`);
        this.cleanup(clientId);
      });
    });

    server.listen(config.proxy.port, config.proxy.host, () => {
      logger.info(
        `✓ Proxy started on ${config.proxy.host}:${config.proxy.port}`
      );
      logger.info(
        `✓ Forwarding to ${config.serverConfig.host}:${config.serverConfig.port}`
      );
    });

    server.on("error", (err) => {
      logger.error(`Server error: ${err.message}`);
    });
  }

  handleClientData(clientId, data) {
    // Check for commands
    const text = data.toString("utf8", 0, Math.min(data.length, 256));

    if (text.includes(config.commands.prefix)) {
      const result = this.commandHandler.execute(clientId, text);
      if (result.handled) {
        logger.info(`[${clientId}] Command executed: ${result.command}`);
        return result.data; // Modified data atau null jika command-only
      }
    }

    return data; // Pass through
  }

  handleServerData(clientId, data) {
    // Inject items, modify responses, etc
    let modifiedData = data;

    if (config.cheats.freeOutfit) {
      modifiedData = this.packetHandler.injectItems(modifiedData, clientId);
    }

    return modifiedData;
  }

  cleanup(clientId) {
    const clientSocket = this.clientSockets.get(clientId);
    const serverSocket = this.serverSockets.get(clientId);

    if (clientSocket) clientSocket.destroy();
    if (serverSocket) serverSocket.destroy();

    this.clientSockets.delete(clientId);
    this.serverSockets.delete(clientId);
  }

  generateClientId() {
    return Math.random().toString(36).substr(2, 9);
  }

  getClientSocket(clientId) {
    return this.clientSockets.get(clientId);
  }

  getServerSocket(clientId) {
    return this.serverSockets.get(clientId);
  }
}

// Start proxy
const proxy = new GrowtopiaProxy();
proxy.start();
