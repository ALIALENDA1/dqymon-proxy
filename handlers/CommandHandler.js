const config = require("../config/config");
const Logger = require("../utils/Logger");

class CommandHandler {
  constructor(proxy) {
    this.proxy = proxy;
    this.logger = new Logger();
    this.userStates = new Map();
  }

  /**
   * Parse dan execute command
   */
  execute(clientId, text) {
    const prefix = config.commands.prefix;

    // Extract command
    const commandMatch = text.match(
      new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\w]+)\\s*(.*)`)
    );

    if (!commandMatch) {
      return { handled: false };
    }

    const command = commandMatch[1].toLowerCase();
    const args = commandMatch[2].trim().split(/\s+/);

    this.logger.info(`[${clientId}] Command: ${command} ${args.join(" ")}`);

    switch (command) {
      case "dropdl":
      case "drop":
        return this.handleDropDL(clientId, args);

      case "warp":
        return this.handleWarp(clientId, args);

      case "outfit":
      case "item":
        return this.handleItem(clientId, args);

      case "help":
        return this.handleHelp(clientId);

      default:
        return { handled: false };
    }
  }

  /**
   * /dropdl <amount> - Berikan DL ke player
   */
  handleDropDL(clientId, args) {
    const amount = parseInt(args[0]) || 1;

    this.logger.info(`[${clientId}] Dropping ${amount} DL`);

    // TODO: Inject packet untuk memberikan DL
    // Packet format Growtopia untuk item drop perlu di-reverse engineer

    return {
      handled: true,
      command: "dropdl",
      data: null, // akan dimodify server response
    };
  }

  /**
   * /warp <world> - Warp ke world tanpa harus keluar
   */
  handleWarp(clientId, args) {
    const world = args[0];

    if (!world) {
      this.logger.warn(`[${clientId}] Warp: world name required`);
      return { handled: false };
    }

    this.logger.info(`[${clientId}] Warping to ${world}`);

    // TODO: Inject warp packet
    // Format: WRLD|worldname atau similar

    return {
      handled: true,
      command: "warp",
      data: null,
    };
  }

  /**
   * /outfit <itemid> - Berikan free outfit/item
   * /item <itemid> <amount> - Berikan item
   */
  handleItem(clientId, args) {
    const itemId = parseInt(args[0]);
    const amount = parseInt(args[1]) || 1;

    if (!itemId) {
      this.logger.warn(`[${clientId}] Item: itemid required`);
      return { handled: false };
    }

    this.logger.info(`[${clientId}] Giving item ${itemId} x${amount}`);

    // TODO: Inject item packet
    // Format: perlu research packet Growtopia

    return {
      handled: true,
      command: "item",
      data: null,
    };
  }

  /**
   * /help - Show available commands
   */
  handleHelp(clientId) {
    const helpText = `
Available Commands:
  /dropdl <amount> - Drop DL (Diamond Locks)
  /warp <world> - Warp ke world
  /outfit <itemid> - Give free outfit
  /item <itemid> [amount] - Give item
  /help - Show this message
    `.trim();

    this.logger.info(`[${clientId}] Help requested`);

    // TODO: Send help to player's chat
    return {
      handled: true,
      command: "help",
      data: null,
    };
  }

  setUserState(clientId, key, value) {
    if (!this.userStates.has(clientId)) {
      this.userStates.set(clientId, {});
    }
    this.userStates.get(clientId)[key] = value;
  }

  getUserState(clientId, key) {
    if (!this.userStates.has(clientId)) return null;
    return this.userStates.get(clientId)[key];
  }

  clearUserState(clientId) {
    this.userStates.delete(clientId);
  }
}

module.exports = CommandHandler;
