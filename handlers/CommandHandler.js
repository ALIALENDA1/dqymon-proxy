const config = require("../config/config");
const Logger = require("../utils/Logger");
const PacketHandler = require("./PacketHandler");

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

    // Send feedback to player
    const msg = PacketHandler.buildConsoleMessage(
      "`4[`#dqymon-proxy`4]`` Drop DL not yet implemented (need packet research)"
    );
    this.proxy.sendToClient(clientId, msg);

    return {
      handled: true,
      command: "dropdl",
      data: null,
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

    // Send feedback to player
    const msg = PacketHandler.buildConsoleMessage(
      "`4[`#dqymon-proxy`4]`` Warp not yet implemented (need packet research)"
    );
    this.proxy.sendToClient(clientId, msg);

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

    // Send feedback to player
    const msg = PacketHandler.buildConsoleMessage(
      "`4[`#dqymon-proxy`4]`` Item injection not yet implemented (need packet research)"
    );
    this.proxy.sendToClient(clientId, msg);

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

    // Send help text to player's chat
    const msg = PacketHandler.buildConsoleMessage(
      "`4[`#dqymon-proxy`4]`` Commands:\n" +
      "`w/dropdl <amount>`` - Drop DL\n" +
      "`w/warp <world>`` - Warp to world\n" +
      "`w/outfit <itemid>`` - Give free outfit\n" +
      "`w/item <itemid> [amount]`` - Give item\n" +
      "`w/help`` - Show this message"
    );
    this.proxy.sendToClient(clientId, msg);

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
