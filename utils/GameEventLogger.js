const Logger = require("./Logger");

/**
 * Game event logger — parses Growtopia server→client variant calls
 * and client→server actions to log human-readable game events.
 *
 * Tracks: world name, player name, netIDs, gems, chat, drops, etc.
 */
class GameEventLogger {
  constructor() {
    this.logger = new Logger();
    this.currentWorld = "";
    this.playerName = "";
    this.localNetID = -1;
    this.players = new Map(); // netID → { name, country }
  }

  // ── Color stripping ──────────────────────────────────────────────

  /**
   * Strip Growtopia color codes from text.
   * GT uses backtick + char: `0-`9, `!, `@, `#, `$, `^, `&, `*, `w, ``, etc.
   */
  stripColors(text) {
    if (!text) return "";
    return text
      .replace(/`[0-9!@#$%^&*wcpqestboi`]/g, "")
      .replace(/`./g, "")
      .trim();
  }

  /**
   * Parse key|value pairs from text (OnSpawn data, action text, etc.)
   */
  parseKeyValues(text) {
    const pairs = {};
    const lines = text.split("\n");
    for (const line of lines) {
      const idx = line.indexOf("|");
      if (idx !== -1) {
        pairs[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
      }
    }
    return pairs;
  }

  // ── Variant call processing ──────────────────────────────────────

  /**
   * Process a parsed variant function call from the server.
   * @param {Array} variants - Array of { index, type, value }
   * @param {string} sessionId - Session identifier
   */
  processVariantCall(variants, sessionId) {
    if (!variants || variants.length === 0) return;
    const func = variants[0];
    if (!func || func.type !== 2) return;

    switch (func.value) {
      case "OnConsoleMessage":
        this.onConsoleMessage(variants);
        break;
      case "OnSpawn":
        this.onSpawn(variants);
        break;
      case "OnTalkBubble":
        this.onTalkBubble(variants);
        break;
      case "OnRemove":
        this.onRemove(variants);
        break;
      case "OnAddNotification":
        this.onNotification(variants);
        break;
      case "SetHasGrowID":
        this.onSetGrowID(variants);
        break;
      case "OnSetBux":
        this.onSetBux(variants);
        break;
      case "OnRequestWorldSelectMenu":
        this.onWorldSelect(variants);
        break;
      case "OnDialogRequest":
        this.onDialog(variants);
        break;
      case "OnTextOverlay":
        this.onTextOverlay(variants);
        break;
      case "OnCountryState":
        break; // silent
      case "OnSendToServer":
        break; // handled by proxy redirect logic
      default:
        this.logger.debug(`[GAME] ${func.value}(${variants.length - 1} args)`);
    }
  }

  // ── Individual variant handlers ──────────────────────────────────

  onConsoleMessage(variants) {
    if (variants.length < 2 || variants[1].type !== 2) return;
    const raw = variants[1].value;
    const clean = this.stripColors(raw);
    if (!clean.trim()) return;

    // Classify the message
    const lower = clean.toLowerCase();
    if (lower.includes("dropped")) {
      this.logger.game(`[DROP] ${clean}`);
    } else if (lower.includes("collected") || lower.includes("picked up") || lower.includes("got")) {
      this.logger.game(`[PICKUP] ${clean}`);
    } else if (lower.includes("entered the world") || lower.includes("left the world")) {
      this.logger.game(`[WORLD] ${clean}`);
    } else if (lower.includes("where would you like to go")) {
      this.logger.game(`[WORLD] ${clean}`);
    } else if (lower.includes("trade") || lower.includes("trading")) {
      this.logger.game(`[TRADE] ${clean}`);
    } else if (lower.includes("is now")) {
      this.logger.game(`[STATUS] ${clean}`);
    } else if (clean.includes("CP:") || clean.includes(">>>")) {
      // Broadcast / super broadcast
      this.logger.game(`[BROADCAST] ${clean}`);
    } else if (clean.includes(": ")) {
      // Chat messages typically have "Name: message"
      this.logger.game(`[CHAT] ${clean}`);
    } else {
      this.logger.game(`[MSG] ${clean}`);
    }
  }

  onSpawn(variants) {
    if (variants.length < 2 || variants[1].type !== 2) return;
    const pairs = this.parseKeyValues(variants[1].value);

    const name = pairs.name || pairs.name2 || "Unknown";
    const netID = parseInt(pairs.netID) || -1;
    const isLocal = pairs.type === "local";
    const userID = pairs.userID || "";
    const level = pairs.level || "";
    const world = pairs.world || "";

    if (isLocal) {
      this.playerName = name;
      this.localNetID = netID;
      if (world) this.currentWorld = world;
      this.logger.game(
        `[SPAWN] You spawned as ${name}` +
        `${this.currentWorld ? ` in ${this.currentWorld}` : ""}` +
        `${level ? ` (lvl ${level})` : ""}`
      );
    } else {
      this.players.set(netID, { name, country: pairs.country || "" });
      this.logger.game(`[PLAYER] ${name} appeared${level ? ` (lvl ${level})` : ""}`);
    }
  }

  onTalkBubble(variants) {
    if (variants.length < 3) return;
    const netID =
      variants[1].type === 5 || variants[1].type === 9
        ? variants[1].value
        : -1;
    const text = variants[2].type === 2 ? this.stripColors(variants[2].value) : "";
    if (!text) return;

    const player = this.players.get(netID);
    const name =
      player
        ? player.name
        : netID === this.localNetID
          ? this.playerName
          : `netID:${netID}`;
    this.logger.game(`[BUBBLE] ${name}: ${text}`);
  }

  onRemove(variants) {
    if (variants.length < 2 || variants[1].type !== 2) return;
    const pairs = this.parseKeyValues(variants[1].value);

    const netID = parseInt(pairs.netID) || -1;
    const player = this.players.get(netID);
    if (player) {
      this.logger.game(`[LEAVE] ${player.name} left`);
      this.players.delete(netID);
    }
  }

  onNotification(variants) {
    if (variants.length < 2 || variants[1].type !== 2) return;
    const clean = this.stripColors(variants[1].value);
    if (clean.trim()) {
      this.logger.game(`[NOTIFY] ${clean}`);
    }
  }

  onSetGrowID(variants) {
    if (variants.length >= 3 && variants[2].type === 2) {
      const name = variants[2].value;
      if (name) {
        this.playerName = name;
        this.logger.game(`[LOGIN] GrowID: ${name}`);
      }
    }
  }

  onSetBux(variants) {
    if (variants.length >= 2 && (variants[1].type === 5 || variants[1].type === 9)) {
      this.logger.game(`[GEMS] Gems: ${variants[1].value}`);
    }
  }

  onWorldSelect(variants) {
    this.logger.game(`[MENU] World select opened`);
    this.currentWorld = "";
    this.players.clear();
  }

  onDialog(variants) {
    if (variants.length < 2 || variants[1].type !== 2) return;
    const content = variants[1].value;
    // Try to extract dialog title
    const titleMatch = content.match(
      /add_label_with_icon\|big\|([^|]+)\|/
    );
    if (titleMatch) {
      this.logger.game(`[DIALOG] ${this.stripColors(titleMatch[1])}`);
    } else {
      this.logger.game(`[DIALOG] Dialog opened`);
    }
  }

  onTextOverlay(variants) {
    if (variants.length < 2 || variants[1].type !== 2) return;
    const clean = this.stripColors(variants[1].value);
    if (clean.trim()) {
      this.logger.game(`[OVERLAY] ${clean}`);
    }
  }

  // ── Client action processing ─────────────────────────────────────

  /**
   * Process a client→server text/action packet (type 3).
   */
  processClientAction(text) {
    const pairs = this.parseKeyValues(text);

    switch (pairs.action) {
      case "join_request":
        this.currentWorld = pairs.name || "";
        this.players.clear();
        this.logger.game(`[JOIN] Joining world: ${this.currentWorld}`);
        break;
      case "quit_to_exit":
        this.logger.game(`[EXIT] Left world: ${this.currentWorld}`);
        this.currentWorld = "";
        this.players.clear();
        break;
      case "quit":
        this.logger.game(`[QUIT] Disconnecting`);
        break;
      case "input":
        if (pairs.text) {
          this.logger.game(`[SAY] You: ${pairs.text}`);
        }
        break;
      case "drop":
        this.logger.game(
          `[DROP] Dropping item ${pairs.itemID || "?"} x${pairs.count || "1"}`
        );
        break;
      case "trash":
        this.logger.game(
          `[TRASH] Trashing item ${pairs.itemID || "?"} x${pairs.count || "1"}`
        );
        break;
    }
  }

  // ── TANK packet processing ───────────────────────────────────────

  /**
   * Process a TANK packet sub-type for relevant game events.
   * @param {number} tankType - TANK sub-type
   * @param {Buffer} payload - 56-byte tank header (+ extra data)
   */
  processTankPacket(tankType, payload) {
    // Tile change (item place/break)
    if (tankType === 3 && payload.length >= 56) {
      const itemID = payload.readUInt16LE(16);
      const tileX = payload.readInt32LE(44);
      const tileY = payload.readInt32LE(48);
      if (itemID > 0) {
        this.logger.debug(`[TILE] Place/break at (${tileX},${tileY}) item=${itemID}`);
      }
    }
  }

  /**
   * Log login info that was captured (before spoofing).
   */
  logLoginInfo(pairs) {
    const name = pairs.tankIDName || pairs.requestedName || "?";
    const country = pairs.country || "?";
    const platform = pairs.platformID || "?";
    const mac = pairs.mac || "?";
    this.logger.game(`[AUTH] Login: ${name} (${country}) platform=${platform} mac=${mac}`);
  }
}

module.exports = GameEventLogger;
