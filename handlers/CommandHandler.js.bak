const config = require("../config/config");
const Logger = require("../utils/Logger");
const PacketHandler = require("./PacketHandler");

// Growtopia item IDs for well-known items
const ITEM = {
  DIAMOND_LOCK: 1796,
  WORLD_LOCK: 242,
  SMALL_LOCK: 202,
  BIG_LOCK: 204,
};

class CommandHandler {
  constructor(proxy) {
    this.proxy = proxy;
    this.logger = new Logger();
    this.userStates = new Map();
  }

  /**
   * Parse and execute command.
   * Returns { handled: true/false, command: string }.
   */
  execute(clientId, text) {
    const prefix = config.commands.prefix;

    // Extract command and args from "/cmd arg1 arg2"
    const commandMatch = text.match(
      new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\w]+)\\s*(.*)`)
    );

    if (!commandMatch) {
      return { handled: false };
    }

    const command = commandMatch[1].toLowerCase();
    const args = commandMatch[2].trim().split(/\s+/).filter(Boolean);

    this.logger.info(`[${clientId}] Command: ${command} ${args.join(" ")}`);

    switch (command) {
      case "dropdl":
      case "drop":
        return this.handleDropDL(clientId, args);

      case "warp":
        return this.handleWarp(clientId, args);

      case "outfit":
        return this.handleOutfit(clientId, args);

      case "help":
        return this.handleHelp(clientId);

      default:
        return { handled: false };
    }
  }

  // ── /dropdl <amount> ───────────────────────────────────────────────
  // Sends a real drop action to the GT server for Diamond Locks.
  // This is a convenience — same as manually dropping from inventory.
  // The server validates you actually own the items.

  handleDropDL(clientId, args) {
    const amount = parseInt(args[0]) || 1;

    if (amount < 1 || amount > 200) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid amount (1-200)");
      return { handled: true, command: "dropdl" };
    }

    // Build a type-3 action packet: "action|drop\n|itemID|1796\n"
    // This is the exact same packet the game sends when you drop from inventory.
    const actionText = `action|drop\n|itemID|${ITEM.DIAMOND_LOCK}\n`;
    const header = Buffer.alloc(4);
    header.writeUInt32LE(3, 0);
    const dropPacket = Buffer.concat([header, Buffer.from(actionText, "utf8")]);

    // Send the drop action to the server <amount> times (1 DL per drop)
    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "dropdl" };
    }

    for (let i = 0; i < amount; i++) {
      this.proxy.outgoingClient.send(session.serverNetID, 0, dropPacket);
    }

    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` Dropped ${amount} Diamond Lock(s)`);
    this.logger.info(`[${clientId}] Dropped ${amount} DL`);

    return { handled: true, command: "dropdl" };
  }

  // ── /warp <world> ─────────────────────────────────────────────────
  // Sends a real join_request action to the GT server.
  // Same as typing the world name in the door/portal UI.

  handleWarp(clientId, args) {
    const world = args[0];

    if (!world) {
      this.sendChat(clientId, "`4[Proxy]`` Usage: /warp <world>");
      return { handled: true, command: "warp" };
    }

    // Build a type-3 action packet: "action|join_request\nname|WORLDNAME\ninvitedWorld|0\n"
    const actionText = `action|join_request\nname|${world.toUpperCase()}\ninvitedWorld|0\n`;
    const header = Buffer.alloc(4);
    header.writeUInt32LE(3, 0);
    const warpPacket = Buffer.concat([header, Buffer.from(actionText, "utf8")]);

    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "warp" };
    }

    this.proxy.outgoingClient.send(session.serverNetID, 0, warpPacket);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` Warping to \`w${world.toUpperCase()}\`\``);
    this.logger.info(`[${clientId}] Warping to ${world}`);

    return { handled: true, command: "warp" };
  }

  // ── /outfit <itemid> [itemid2] [itemid3] ... ──────────────────────
  // CLIENT-SIDE ONLY — sends OnSetClothing to YOUR game client.
  // Changes how your character looks LOCALLY. The server still sees
  // your real outfit. Other players see your real outfit.
  // Nothing is sent to the server — cannot cause ban.

  handleOutfit(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId,
        "`4[`#Proxy`4]`` Usage: /outfit <hat> [shirt] [pants] [shoes] [face] [hand] [back] [hair] [neck]\n" +
        "`4[`#Proxy`4]`` Use 0 to skip a slot. Example: /outfit 5064 0 0 0 0 0 5066"
      );
      return { handled: true, command: "outfit" };
    }

    // Parse up to 9 clothing slots: hat, shirt, pants, shoes, face, hand, back, hair, neck
    const slots = [];
    for (let i = 0; i < 9; i++) {
      slots.push(parseInt(args[i]) || 0);
    }

    const [hat, shirt, pants, shoes, face, hand, back, hair, neck] = slots;

    // Build OnSetClothing variant call — sent to client only
    // OnSetClothing(vec3 hatShirtPants, vec3 shoesFaceHand, vec3 backHairNeck)
    // Each component is (float)itemID
    const clothingPacket = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnSetClothing" },
      { type: 4, value: [hat, shirt, pants] },
      { type: 4, value: [shoes, face, hand] },
      { type: 4, value: [back, hair, neck] },
    ], this.proxy.gameEventLogger.localNetID, 0);

    this.proxy.sendToClient(clientId, clothingPacket);
    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Outfit applied (client-side only, others can't see it)"
    );
    this.logger.info(`[${clientId}] Client-side outfit: hat=${hat} shirt=${shirt} pants=${pants} shoes=${shoes} face=${face} hand=${hand} back=${back} hair=${hair} neck=${neck}`);

    return { handled: true, command: "outfit" };
  }

  // ── /help ─────────────────────────────────────────────────────────

  handleHelp(clientId) {
    this.logger.info(`[${clientId}] Help requested`);

    this.sendChat(clientId,
      "`4[`#dqymon-proxy`4]`` Commands:\n" +
      "`w/dropdl <amount>`` - Drop Diamond Locks from inventory\n" +
      "`w/warp <world>`` - Warp to world\n" +
      "`w/outfit <hat> [shirt] [pants] [shoes] [face] [hand] [back] [hair] [neck]`` - Visual outfit (client-side)\n" +
      "`w/help`` - Show this message"
    );

    return { handled: true, command: "help" };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  /** Send a chat message to the game client via OnConsoleMessage */
  sendChat(clientId, text) {
    const msg = PacketHandler.buildConsoleMessage(text);
    this.proxy.sendToClient(clientId, msg);
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
