const config = require("../config/config");
const Logger = require("../utils/Logger");
const PacketHandler = require("./PacketHandler");
const ConfigStore = require("../utils/ConfigStore");
const crypto = require("crypto");

// Growtopia item IDs
const ITEM = {
  DIAMOND_LOCK: 1796,
  WORLD_LOCK: 242,
  SMALL_LOCK: 202,
  BIG_LOCK: 204,
  BLUE_GEM_LOCK: 7188,
};

class CommandHandler {
  constructor(proxy) {
    this.proxy = proxy;
    this.logger = new Logger();
    this.store = new ConfigStore();
    this.userStates = new Map();
    // Tracking state for passive radar
    this.itemTracker = [];       // { time, item, action, world }
    this.growscanResult = null;  // last scan result
  }

  /**
   * Parse and execute command.
   * Returns { handled: true/false, command: string }.
   */
  execute(clientId, text) {
    const prefix = config.commands.prefix;

    const commandMatch = text.match(
      new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\w]+)\\s*(.*)`)
    );

    if (!commandMatch) {
      return { handled: false };
    }

    const command = commandMatch[1].toLowerCase();
    const args = commandMatch[2].trim().split(/\s+/).filter(Boolean);

    this.logger.info(`[${clientId}] Command: /${command} ${args.join(" ")}`);

    // Save last command for /re
    if (command !== "re") {
      this.store.set("lastCommand", `/${command} ${args.join(" ")}`.trim());
      this.store.save();
    }

    // ─── Foundation: State & Configuration ───
    switch (command) {
      case "proxy":   return this.cmdProxy(clientId);
      case "keep":    return this.cmdKeep(clientId);
      case "settings":
      case "options": return this.cmdSettings(clientId);
      case "switch":  return this.cmdSwitch(clientId, args);
      case "account": return this.cmdAccount(clientId, args);
      case "mac":     return this.cmdMac(clientId, args);
      case "pass":    return this.cmdPass(clientId, args);
      case "nick":    return this.cmdNick(clientId, args);
      case "logs":    return this.cmdLogs(clientId);
      case "server":  return this.cmdServer(clientId);
      case "re":      return this.cmdRe(clientId);

      // ─── Tier 1: Passive Radar & Analytics ───
      case "growscan": return this.cmdGrowscan(clientId);
      case "chest":    return this.cmdChest(clientId);
      case "gems":     return this.cmdGems(clientId);
      case "hidden":   return this.cmdHidden(clientId);
      case "track":    return this.cmdTrack(clientId, args);
      case "balance":  return this.cmdBalance(clientId);
      case "check":    return this.cmdCheck(clientId);
      case "players":  return this.cmdPlayers(clientId);

      // ─── Tier 2: Clean UI Bypasses & Utility ───
      case "fastvend": return this.cmdFastvend(clientId, args);
      case "trash":    return this.cmdTrash(clientId, args);
      case "drop":
      case "dropdl":   return this.cmdDrop(clientId, args);
      case "buy":      return this.cmdBuy(clientId, args);
      case "count":    return this.cmdCount(clientId, args);
      case "cdrop":    return this.cmdCdrop(clientId, args);
      case "ddrop":    return this.cmdDdrop(clientId, args);
      case "game":     return this.cmdGame(clientId, args);
      case "game1":    return this.cmdGame1(clientId, args);
      case "game2":    return this.cmdGame2(clientId, args);
      case "split":    return this.cmdSplit(clientId, args);
      case "warp":     return this.cmdWarp(clientId, args);
      case "door":     return this.cmdDoor(clientId, args);
      case "save":     return this.cmdSave(clientId, args);
      case "back":     return this.cmdBack(clientId);
      case "relog":    return this.cmdRelog(clientId);
      case "logoff":   return this.cmdLogoff(clientId);
      case "rndm":     return this.cmdRndm(clientId);
      case "pullall":  return this.cmdPullall(clientId);
      case "kickall":  return this.cmdKickall(clientId);
      case "banall":   return this.cmdBanall(clientId);
      case "unall":    return this.cmdUnall(clientId);

      // ─── Tier 4: Visual Illusions (Client-Side Only) ───
      case "clothes":
      case "outfit":   return this.cmdClothes(clientId, args);
      case "skin":     return this.cmdSkin(clientId, args);
      case "flag":     return this.cmdFlag(clientId, args);
      case "title":
      case "titles":   return this.cmdTitle(clientId, args);
      case "name":     return this.cmdName(clientId, args);
      case "country":  return this.cmdCountry(clientId, args);
      case "mod":      return this.cmdMod(clientId);
      case "dev":      return this.cmdDev(clientId);
      case "replace":  return this.cmdReplace(clientId, args);

      case "help":     return this.cmdHelp(clientId);
      default:         return { handled: false };
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🏗️ FOUNDATION: State & Configuration
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdProxy(clientId) {
    this.sendChat(clientId,
      "`4[`#dqymon-proxy`4]`` `wv1.0`` — Command Reference\n" +
      "\n" +
      "`w🏗️ Configuration``\n" +
      "`5/keep`` — Save current settings\n" +
      "`5/settings`` — View current settings\n" +
      "`5/switch [name]`` — Switch account\n" +
      "`5/account [add|del|list]`` — Manage accounts\n" +
      "`5/mac [address|random|reset]`` — Set MAC address\n" +
      "`5/nick [name]`` — Set display nickname\n" +
      "`5/logs`` — View saved proxy logs path\n" +
      "`5/server`` — Current server info\n" +
      "`5/re`` — Repeat last command\n" +
      "\n" +
      "`w📡 Passive Radar``\n" +
      "`5/growscan`` — Scan world info\n" +
      "`5/chest`` — Show chest/hidden items in world\n" +
      "`5/gems`` — Count gems on ground\n" +
      "`5/hidden`` — Show hidden players\n" +
      "`5/track [on|off|show]`` — Log item drops/collects\n" +
      "`5/balance`` — Show current gem/lock count\n" +
      "`5/check`` — Account info summary\n" +
      "`5/players`` — List players in world\n" +
      "\n" +
      "`w⚡ Quick Actions``\n" +
      "`5/fastvend [buy|sell] [id] [qty]`` — Fast vend action\n" +
      "`5/trash [id] [amount]`` — Quick trash items\n" +
      "`5/drop [amount]`` — Drop Diamond Locks\n" +
      "`5/buy [id] [amount]`` — Buy from store\n" +
      "`5/cdrop [wl|dl] [amount]`` — Calculated lock drop\n" +
      "`5/ddrop [amount]`` — Drop specific DL count\n" +
      "`5/game [amount]`` — Calculate taxed outcome\n" +
      "`5/split [amount] [ways]`` — Split locks evenly\n" +
      "`5/warp [world]`` — Fast warp\n" +
      "`5/door [id]`` — Enter door by ID\n" +
      "`5/save [name]`` — Save current world\n" +
      "`5/back`` — Return to last saved world\n" +
      "`5/relog`` — Quick reconnect\n" +
      "`5/logoff`` — Disconnect from server\n" +
      "`5/rndm`` — Warp to random world\n" +
      "`5/pullall`` — Pull everyone (admin)\n" +
      "`5/kickall`` — Kick everyone (admin)\n" +
      "`5/banall`` — Ban everyone (admin)\n" +
      "`5/unall`` — Unban everyone (admin)\n" +
      "\n" +
      "`w🎭 Visual (Client-Side)``\n" +
      "`5/clothes [slots...]`` — Change outfit visuals\n" +
      "`5/skin [color]`` — Change skin color\n" +
      "`5/flag [id]`` — Change flag visual\n" +
      "`5/title [text]`` — Set title visual\n" +
      "`5/name [text]`` — Change name visual\n" +
      "`5/country [code]`` — Change country visual\n" +
      "`5/mod`` — Visual moderator look\n" +
      "`5/dev`` — Visual developer look\n" +
      "`5/replace [id1] [id2]`` — Replace tile visuals"
    );
    return { handled: true, command: "proxy" };
  }

  cmdKeep(clientId) {
    if (this.store.save()) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` `2✓ Settings saved to config.json``");
    } else {
      this.sendChat(clientId, "`4[Proxy]`` `4✗ Failed to save settings``");
    }
    return { handled: true, command: "keep" };
  }

  cmdSettings(clientId) {
    const d = this.store.data;
    const mac = d.spoof.mac || "random";
    const accts = d.accounts.length;
    const saved = d.savedWorlds.length;
    const world = this.proxy.gameEventLogger.currentWorld || "(none)";
    const name = this.proxy.gameEventLogger.playerName || "(unknown)";

    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Current Settings:\n" +
      `  \`wPlayer:\`\` ${name}\n` +
      `  \`wWorld:\`\` ${world}\n` +
      `  \`wMAC:\`\` ${mac}\n` +
      `  \`wAccounts saved:\`\` ${accts}\n` +
      `  \`wSaved worlds:\`\` ${saved}\n` +
      `  \`wLast command:\`\` ${d.lastCommand || "(none)"}`
    );
    return { handled: true, command: "settings" };
  }

  cmdSwitch(clientId, args) {
    const accounts = this.store.get("accounts") || [];

    if (args.length === 0) {
      if (accounts.length === 0) {
        this.sendChat(clientId, "`4[`#Proxy`4]`` No saved accounts. Use `w/account add [name]``");
        return { handled: true, command: "switch" };
      }
      const list = accounts.map((a, i) => `  ${i + 1}. \`w${a.name}\`\`${a.active ? " \`2(active)\`\`" : ""}`).join("\n");
      this.sendChat(clientId, "`4[`#Proxy`4]`` Saved accounts:\n" + list + "\n  Use `w/switch [name]`` to switch");
      return { handled: true, command: "switch" };
    }

    const target = args[0].toLowerCase();
    const found = accounts.find(a => a.name.toLowerCase() === target);
    if (!found) {
      this.sendChat(clientId, `\`4[Proxy]\`\` Account '${args[0]}' not found. Use \`w/account list\`\``);
      return { handled: true, command: "switch" };
    }

    accounts.forEach(a => a.active = false);
    found.active = true;
    this.store.set("accounts", accounts);
    this.store.save();
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Switched to account: ${found.name}\`\` — use \`w/relog\`\` to apply`);
    return { handled: true, command: "switch" };
  }

  cmdAccount(clientId, args) {
    const accounts = this.store.get("accounts") || [];

    if (args.length === 0 || args[0] === "list") {
      if (accounts.length === 0) {
        this.sendChat(clientId, "`4[`#Proxy`4]`` No saved accounts.\n  `w/account add [name]`` — Add account\n  `w/account del [name]`` — Remove account");
        return { handled: true, command: "account" };
      }
      const list = accounts.map((a, i) => `  ${i + 1}. \`w${a.name}\`\`${a.active ? " \`2(active)\`\`" : ""}`).join("\n");
      this.sendChat(clientId, "`4[`#Proxy`4]`` Accounts:\n" + list);
      return { handled: true, command: "account" };
    }

    if (args[0] === "add" && args[1]) {
      const name = args[1];
      if (accounts.find(a => a.name.toLowerCase() === name.toLowerCase())) {
        this.sendChat(clientId, "`4[Proxy]`` Account already exists");
        return { handled: true, command: "account" };
      }
      accounts.push({ name, active: false, addedAt: Date.now() });
      this.store.set("accounts", accounts);
      this.store.save();
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Account '${name}' added\`\``);
      return { handled: true, command: "account" };
    }

    if (args[0] === "del" && args[1]) {
      const target = args[1].toLowerCase();
      const idx = accounts.findIndex(a => a.name.toLowerCase() === target);
      if (idx === -1) {
        this.sendChat(clientId, "`4[Proxy]`` Account not found");
        return { handled: true, command: "account" };
      }
      const removed = accounts.splice(idx, 1);
      this.store.set("accounts", accounts);
      this.store.save();
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Removed '${removed[0].name}'\`\``);
      return { handled: true, command: "account" };
    }

    this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /account [add|del|list] [name]");
    return { handled: true, command: "account" };
  }

  cmdMac(clientId, args) {
    if (args.length === 0) {
      const currentMac = this.proxy.spoofState.enabled ? this.proxy.spoofState.mac : "disabled";
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` Current MAC: \`w${currentMac}\`\`\n  Usage: /mac [address|random|reset]`);
      return { handled: true, command: "mac" };
    }

    const val = args[0].toLowerCase();
    if (val === "random") {
      this.store.data.spoof.mac = "random";
      this.store.save();
      this.sendChat(clientId, "`4[`#Proxy`4]`` `2✓ MAC set to random`` — applies on next login");
    } else if (val === "reset") {
      this.store.data.spoof.mac = "random";
      this.store.save();
      this.sendChat(clientId, "`4[`#Proxy`4]`` `2✓ MAC reset to random``");
    } else if (/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(val)) {
      this.store.data.spoof.mac = val;
      this.store.save();
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ MAC set to ${val}\`\` — applies on next login`);
    } else {
      this.sendChat(clientId, "`4[Proxy]`` Invalid MAC format. Use xx:xx:xx:xx:xx:xx");
    }
    return { handled: true, command: "mac" };
  }

  cmdPass(clientId, args) {
    this.sendChat(clientId, "`4[`#Proxy`4]`` Password management requires game UI — use the GrowID dialog in-game.");
    return { handled: true, command: "pass" };
  }

  cmdNick(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /nick [name] — Set local display name (client-side only)");
      return { handled: true, command: "nick" };
    }

    const newName = args.join(" ");
    this.store.data.visuals.customName = newName;
    this.store.save();

    // Send OnNameChanged to client (visual only)
    const namePacket = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnNameChanged" },
      { type: 2, value: `\`2${newName}\`\`` },
      { type: 9, value: 0 },
    ], this.proxy.gameEventLogger.localNetID, 0);
    this.proxy.sendToClient(clientId, namePacket);

    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Display name set to ${newName}\`\` (client-side only)`);
    return { handled: true, command: "nick" };
  }

  cmdLogs(clientId) {
    const logPath = this.proxy.gameLog ? this.proxy.gameLog.logPath : "(unknown)";
    this.sendChat(clientId,
      `\`4[\`#Proxy\`4]\`\` Log files:\n` +
      `  \`wGame log:\`\` ${logPath}\n` +
      `  \`wConfig:\`\` ${this.store.filePath}`
    );
    return { handled: true, command: "logs" };
  }

  cmdServer(clientId) {
    const session = this.proxy.getSession(clientId);
    if (!session) {
      this.sendChat(clientId, "`4[Proxy]`` No active session");
      return { handled: true, command: "server" };
    }

    const world = this.proxy.gameEventLogger.currentWorld || "(none)";
    const name = this.proxy.gameEventLogger.playerName || "(unknown)";
    const players = this.proxy.gameEventLogger.players.size;

    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Server Info:\n" +
      `  \`wServer:\`\` ${session.serverHost}:${session.serverPort}\n` +
      `  \`wProxy:\`\` ${config.proxy.host}:${config.proxy.port}\n` +
      `  \`wPlayer:\`\` ${name}\n` +
      `  \`wWorld:\`\` ${world}\n` +
      `  \`wPlayers visible:\`\` ${players}\n` +
      `  \`wSub-server:\`\` ${session.isSubServerRedirect ? "Yes" : "No"}\n` +
      `  \`wPackets:\`\` ↑${session.clientPackets} ↓${session.serverPackets}\n` +
      `  \`wUptime:\`\` ${Math.floor((Date.now() - session.lastActivity) / 1000)}s idle`
    );
    return { handled: true, command: "server" };
  }

  cmdRe(clientId) {
    const lastCmd = this.store.get("lastCommand");
    if (!lastCmd) {
      this.sendChat(clientId, "`4[Proxy]`` No previous command to repeat");
      return { handled: true, command: "re" };
    }
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` Repeating: \`w${lastCmd}\`\``);
    return this.execute(clientId, lastCmd);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 📡 TIER 1: Passive Radar & Analytics
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdGrowscan(clientId) {
    const gel = this.proxy.gameEventLogger;
    const world = gel.currentWorld || "(unknown)";
    const players = gel.players;
    const localName = gel.playerName || "(unknown)";

    const playerList = [];
    for (const [netID, info] of players) {
      playerList.push(`  \`w${info.name}\`\` ${info.country ? `(${info.country})` : ""} [netID:${netID}]`);
    }

    this.sendChat(clientId,
      "`4[`#GrowScan`4]`` World Report:\n" +
      `  \`wWorld:\`\` ${world}\n` +
      `  \`wYou:\`\` ${localName} [netID:${gel.localNetID}]\n` +
      `  \`wPlayers:\`\` ${players.size}\n` +
      (playerList.length > 0 ? playerList.join("\n") : "  (no other players)")
    );
    return { handled: true, command: "growscan" };
  }

  cmdChest(clientId) {
    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Chest/hidden item scan:\n" +
      "  `wNote:`` This scans tile data received from server.\n" +
      "  Enter/re-enter the world to refresh tile data.\n" +
      "  Hidden items are logged as they're received."
    );
    return { handled: true, command: "chest" };
  }

  cmdGems(clientId) {
    const gel = this.proxy.gameEventLogger;
    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Gem Info:\n" +
      `  \`wWorld:\`\` ${gel.currentWorld || "(none)"}\n` +
      "  `wNote:`` Gem count from dropped items is tracked via /track"
    );
    return { handled: true, command: "gems" };
  }

  cmdHidden(clientId) {
    const gel = this.proxy.gameEventLogger;
    const players = gel.players;

    const list = [];
    for (const [netID, info] of players) {
      list.push(`  \`w${info.name}\`\` [netID:${netID}]`);
    }

    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Players detected in world (includes hidden):\n" +
      `  \`wTotal:\`\` ${players.size} players\n` +
      (list.length > 0 ? list.join("\n") : "  (no players)")
    );
    return { handled: true, command: "hidden" };
  }

  cmdTrack(clientId, args) {
    const sub = (args[0] || "show").toLowerCase();

    if (sub === "on") {
      this.setUserState(clientId, "tracking", true);
      this.sendChat(clientId, "`4[`#Proxy`4]`` `2✓ Item tracking ON`` — drops/collects will be logged");
      return { handled: true, command: "track" };
    }

    if (sub === "off") {
      this.setUserState(clientId, "tracking", false);
      this.sendChat(clientId, "`4[`#Proxy`4]`` Item tracking OFF");
      return { handled: true, command: "track" };
    }

    // Show tracked items
    if (this.itemTracker.length === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` No items tracked yet. Use `w/track on`` to start.");
    } else {
      const recent = this.itemTracker.slice(-10);
      const lines = recent.map(t => {
        const ago = Math.floor((Date.now() - t.time) / 1000);
        return `  ${t.action === "drop" ? "\`4↓\`\`" : "\`2↑\`\`"} ${t.item} in ${t.world} (${ago}s ago)`;
      });
      this.sendChat(clientId,
        `\`4[\`#Proxy\`4]\`\` Item log (last ${recent.length}):\n` + lines.join("\n")
      );
    }
    return { handled: true, command: "track" };
  }

  cmdBalance(clientId) {
    const gel = this.proxy.gameEventLogger;
    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Balance Info:\n" +
      `  \`wGems:\`\` ${gel.lastGems !== undefined ? gel.lastGems : "(unknown)"}\n` +
      `  \`wPlayer:\`\` ${gel.playerName || "(unknown)"}\n` +
      "  `wNote:`` Lock count is updated when the server sends gem data"
    );
    return { handled: true, command: "balance" };
  }

  cmdCheck(clientId) {
    const gel = this.proxy.gameEventLogger;
    const session = this.proxy.getSession(clientId);
    const mac = this.proxy.spoofState.enabled ? this.proxy.spoofState.mac : "(unspoofed)";

    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Account Check:\n" +
      `  \`wGrowID:\`\` ${gel.playerName || "(unknown)"}\n` +
      `  \`wMAC:\`\` ${mac}\n` +
      `  \`wServer:\`\` ${session ? `${session.serverHost}:${session.serverPort}` : "(none)"}\n` +
      `  \`wWorld:\`\` ${gel.currentWorld || "(none)"}\n` +
      `  \`wPlayers tracked:\`\` ${gel.players.size}\n` +
      `  \`wSub-server:\`\` ${session && session.isSubServerRedirect ? "Yes" : "No"}`
    );
    return { handled: true, command: "check" };
  }

  cmdPlayers(clientId) {
    const gel = this.proxy.gameEventLogger;
    const players = gel.players;

    if (players.size === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` No other players in world");
      return { handled: true, command: "players" };
    }

    const list = [];
    for (const [netID, info] of players) {
      list.push(`  \`w${info.name}\`\` ${info.country ? `(${info.country})` : ""} [netID:${netID}]`);
    }
    this.sendChat(clientId,
      `\`4[\`#Proxy\`4]\`\` Players in ${gel.currentWorld || "world"} (${players.size}):\n` + list.join("\n")
    );
    return { handled: true, command: "players" };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ⚡ TIER 2: Clean UI Bypasses & Utility
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdFastvend(clientId, args) {
    if (args.length < 3) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /fastvend [buy|sell] [itemID] [qty]");
      return { handled: true, command: "fastvend" };
    }

    const action = args[0].toLowerCase();
    const itemID = parseInt(args[1]);
    const qty = Math.min(Math.max(parseInt(args[2]) || 1, 1), 200);

    if (!itemID || itemID <= 0) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid item ID");
      return { handled: true, command: "fastvend" };
    }

    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "fastvend" };
    }

    if (action === "buy") {
      const actionText = `action|buy\n|itemID|${itemID}\n|count|${qty}\n`;
      const pkt = this.buildActionPacket(actionText);
      this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Fast-buy sent:\`\` item ${itemID} x${qty}`);
    } else if (action === "sell") {
      const actionText = `action|sell\n|itemID|${itemID}\n|count|${qty}\n`;
      const pkt = this.buildActionPacket(actionText);
      this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Fast-sell sent:\`\` item ${itemID} x${qty}`);
    } else {
      this.sendChat(clientId, "`4[Proxy]`` First argument must be 'buy' or 'sell'");
    }

    return { handled: true, command: "fastvend" };
  }

  cmdTrash(clientId, args) {
    if (args.length < 1) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /trash [itemID] [amount=1]");
      return { handled: true, command: "trash" };
    }

    const itemID = parseInt(args[0]);
    const amount = Math.min(Math.max(parseInt(args[1]) || 1, 1), 200);

    if (!itemID || itemID <= 0) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid item ID");
      return { handled: true, command: "trash" };
    }

    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "trash" };
    }

    const actionText = `action|trash\n|itemID|${itemID}\n|count|${amount}\n`;
    const pkt = this.buildActionPacket(actionText);
    this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Trashed:\`\` item ${itemID} x${amount}`);

    return { handled: true, command: "trash" };
  }

  cmdDrop(clientId, args) {
    const amount = Math.min(Math.max(parseInt(args[0]) || 1, 1), 200);

    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "drop" };
    }

    const actionText = `action|drop\n|itemID|${ITEM.DIAMOND_LOCK}\n`;
    const pkt = this.buildActionPacket(actionText);
    for (let i = 0; i < amount; i++) {
      this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    }
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Dropped ${amount} Diamond Lock(s)\`\``);
    return { handled: true, command: "drop" };
  }

  cmdBuy(clientId, args) {
    if (args.length < 1) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /buy [itemID] [amount=1]");
      return { handled: true, command: "buy" };
    }

    const itemID = parseInt(args[0]);
    const amount = Math.min(Math.max(parseInt(args[1]) || 1, 1), 200);

    if (!itemID || itemID <= 0) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid item ID");
      return { handled: true, command: "buy" };
    }

    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "buy" };
    }

    const actionText = `action|buy\n|itemID|${itemID}\n|count|${amount}\n`;
    const pkt = this.buildActionPacket(actionText);
    this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Buy sent:\`\` item ${itemID} x${amount}`);
    return { handled: true, command: "buy" };
  }

  cmdCount(clientId, args) {
    if (args.length < 1) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /count [number] — Shows lock breakdown");
      return { handled: true, command: "count" };
    }

    const total = parseInt(args[0]);
    if (isNaN(total) || total <= 0) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid number");
      return { handled: true, command: "count" };
    }

    const bgls = Math.floor(total / 10000);
    const remaining = total % 10000;
    const dls = Math.floor(remaining / 100);
    const wls = remaining % 100;

    this.sendChat(clientId,
      `\`4[\`#Proxy\`4]\`\` \`w${total} WLs\`\` breakdown:\n` +
      `  \`5${bgls}\`\` BGL + \`5${dls}\`\` DL + \`5${wls}\`\` WL`
    );
    return { handled: true, command: "count" };
  }

  cmdCdrop(clientId, args) {
    if (args.length < 2) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /cdrop [wl|dl] [amount]");
      return { handled: true, command: "cdrop" };
    }

    const type = args[0].toLowerCase();
    const amount = Math.min(Math.max(parseInt(args[1]) || 1, 1), 200);
    let itemID;

    if (type === "wl") {
      itemID = ITEM.WORLD_LOCK;
    } else if (type === "dl") {
      itemID = ITEM.DIAMOND_LOCK;
    } else {
      this.sendChat(clientId, "`4[Proxy]`` Type must be 'wl' or 'dl'");
      return { handled: true, command: "cdrop" };
    }

    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "cdrop" };
    }

    const actionText = `action|drop\n|itemID|${itemID}\n`;
    const pkt = this.buildActionPacket(actionText);
    for (let i = 0; i < amount; i++) {
      this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    }
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Dropped ${amount} ${type.toUpperCase()}\`\``);
    return { handled: true, command: "cdrop" };
  }

  cmdDdrop(clientId, args) {
    const amount = Math.min(Math.max(parseInt(args[0]) || 1, 1), 200);

    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "ddrop" };
    }

    const actionText = `action|drop\n|itemID|${ITEM.DIAMOND_LOCK}\n`;
    const pkt = this.buildActionPacket(actionText);
    for (let i = 0; i < amount; i++) {
      this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    }
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Dropped ${amount} DL\`\``);
    return { handled: true, command: "ddrop" };
  }

  cmdGame(clientId, args) {
    if (args.length < 1) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /game [wl amount] — Calculates 5% tax outcome");
      return { handled: true, command: "game" };
    }

    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid amount");
      return { handled: true, command: "game" };
    }

    const tax = Math.ceil(amount * 0.05);
    const net = amount - tax;

    this.sendChat(clientId,
      `\`4[\`#Proxy\`4]\`\` Tax Calculator:\n` +
      `  \`wAmount:\`\` ${amount} WL\n` +
      `  \`4Tax (5%):\`\` ${tax} WL\n` +
      `  \`2Net:\`\` ${net} WL\n` +
      `  \`wIn DLs:\`\` ${Math.floor(net / 100)} DL + ${net % 100} WL`
    );
    return { handled: true, command: "game" };
  }

  cmdGame1(clientId, args) {
    if (args.length < 1) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /game1 [desired WL] — How much to give to receive X after tax");
      return { handled: true, command: "game1" };
    }

    const desired = parseInt(args[0]);
    if (isNaN(desired) || desired <= 0) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid amount");
      return { handled: true, command: "game1" };
    }

    const needed = Math.ceil(desired / 0.95);
    const tax = needed - desired;

    this.sendChat(clientId,
      `\`4[\`#Proxy\`4]\`\` To receive \`2${desired}\`\` WL after tax:\n` +
      `  \`wNeed:\`\` ${needed} WL\n` +
      `  \`4Tax:\`\` ${tax} WL`
    );
    return { handled: true, command: "game1" };
  }

  cmdGame2(clientId, args) {
    if (args.length < 2) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /game2 [amount] [tax%] — Custom tax calculation");
      return { handled: true, command: "game2" };
    }

    const amount = parseInt(args[0]);
    const taxRate = parseFloat(args[1]);
    if (isNaN(amount) || isNaN(taxRate) || amount <= 0 || taxRate < 0 || taxRate > 100) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid amount or tax rate");
      return { handled: true, command: "game2" };
    }

    const tax = Math.ceil(amount * (taxRate / 100));
    const net = amount - tax;

    this.sendChat(clientId,
      `\`4[\`#Proxy\`4]\`\` Custom Tax (${taxRate}%):\n` +
      `  \`wAmount:\`\` ${amount} WL\n` +
      `  \`4Tax:\`\` ${tax} WL\n` +
      `  \`2Net:\`\` ${net} WL`
    );
    return { handled: true, command: "game2" };
  }

  cmdSplit(clientId, args) {
    if (args.length < 2) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /split [total WL] [people]");
      return { handled: true, command: "split" };
    }

    const total = parseInt(args[0]);
    const people = parseInt(args[1]);

    if (isNaN(total) || isNaN(people) || total <= 0 || people <= 0) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid numbers");
      return { handled: true, command: "split" };
    }

    const each = Math.floor(total / people);
    const remainder = total % people;

    this.sendChat(clientId,
      `\`4[\`#Proxy\`4]\`\` Split \`w${total}\`\` WL among \`w${people}\`\` people:\n` +
      `  \`wEach gets:\`\` ${each} WL\n` +
      `  \`wRemainder:\`\` ${remainder} WL\n` +
      `  \`wIn DLs:\`\` ${Math.floor(each / 100)} DL + ${each % 100} WL each`
    );
    return { handled: true, command: "split" };
  }

  cmdWarp(clientId, args) {
    if (!args[0]) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /warp [world]");
      return { handled: true, command: "warp" };
    }

    const world = args[0].toUpperCase();
    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "warp" };
    }

    const actionText = `action|join_request\nname|${world}\ninvitedWorld|0\n`;
    const pkt = this.buildActionPacket(actionText);
    this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2Warping to \`w${world}\`\`\`\``);
    return { handled: true, command: "warp" };
  }

  cmdDoor(clientId, args) {
    if (!args[0]) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /door [doorID] — Enter a specific door");
      return { handled: true, command: "door" };
    }

    const doorID = args[0];
    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "door" };
    }

    const actionText = `action|enter_door\ndoor|${doorID}\n`;
    const pkt = this.buildActionPacket(actionText);
    this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2Entering door ${doorID}\`\``);
    return { handled: true, command: "door" };
  }

  cmdSave(clientId, args) {
    const world = this.proxy.gameEventLogger.currentWorld;
    if (!world) {
      this.sendChat(clientId, "`4[Proxy]`` You're not in a world");
      return { handled: true, command: "save" };
    }

    const label = args[0] || world;
    const saved = this.store.get("savedWorlds") || [];

    if (!saved.find(w => w.world === world)) {
      saved.push({ world, label, savedAt: Date.now() });
      this.store.set("savedWorlds", saved);
      this.store.save();
    }

    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Saved world:\`\` ${world} (as '${label}')`);
    return { handled: true, command: "save" };
  }

  cmdBack(clientId) {
    const saved = this.store.get("savedWorlds") || [];
    if (saved.length === 0) {
      this.sendChat(clientId, "`4[Proxy]`` No saved worlds. Use `w/save`` first");
      return { handled: true, command: "back" };
    }

    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "back" };
    }

    const last = saved[saved.length - 1];
    const actionText = `action|join_request\nname|${last.world}\ninvitedWorld|0\n`;
    const pkt = this.buildActionPacket(actionText);
    this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2Warping back to\`\` \`w${last.world}\`\``);
    return { handled: true, command: "back" };
  }

  cmdRelog(clientId) {
    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "relog" };
    }

    const actionText = `action|quit\n`;
    const pkt = this.buildActionPacket(actionText);
    this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    this.sendChat(clientId, "`4[`#Proxy`4]`` `2Relogging...`` The game will reconnect.");
    return { handled: true, command: "relog" };
  }

  cmdLogoff(clientId) {
    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "logoff" };
    }

    const actionText = `action|quit\n`;
    const pkt = this.buildActionPacket(actionText);
    this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    this.sendChat(clientId, "`4[`#Proxy`4]`` `4Logged off from server``");
    return { handled: true, command: "logoff" };
  }

  cmdRndm(clientId) {
    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "rndm" };
    }

    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const len = 5 + Math.floor(Math.random() * 4);
    let name = "";
    for (let i = 0; i < len; i++) name += chars[Math.floor(Math.random() * chars.length)];

    const actionText = `action|join_request\nname|${name}\ninvitedWorld|0\n`;
    const pkt = this.buildActionPacket(actionText);
    this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2Random warp:\`\` \`w${name}\`\``);
    return { handled: true, command: "rndm" };
  }

  // ── World admin commands (sends real action packets — requires admin) ──

  cmdPullall(clientId) {
    return this.sendWorldAction(clientId, "action|input\n|text|/pullall\n", "pullall", "Pull all sent");
  }

  cmdKickall(clientId) {
    return this.sendWorldAction(clientId, "action|input\n|text|/kickall\n", "kickall", "Kick all sent");
  }

  cmdBanall(clientId) {
    return this.sendWorldAction(clientId, "action|input\n|text|/banall\n", "banall", "Ban all sent");
  }

  cmdUnall(clientId) {
    return this.sendWorldAction(clientId, "action|input\n|text|/unbanall\n", "unall", "Unban all sent");
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🎭 TIER 4: Visual Illusions (Client-Side Only)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdClothes(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId,
        "`4[`#Proxy`4]`` Usage: /clothes [hat] [shirt] [pants] [shoes] [face] [hand] [back] [hair] [neck]\n" +
        "  Use 0 to skip a slot. Example: /clothes 5064 0 0 0 0 0 5066\n" +
        "  `wClient-side only`` — others see your real outfit"
      );
      return { handled: true, command: "clothes" };
    }

    const slots = [];
    for (let i = 0; i < 9; i++) {
      slots.push(parseInt(args[i]) || 0);
    }
    const [hat, shirt, pants, shoes, face, hand, back, hair, neck] = slots;

    const clothingPacket = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnSetClothing" },
      { type: 4, value: [hat, shirt, pants] },
      { type: 4, value: [shoes, face, hand] },
      { type: 4, value: [back, hair, neck] },
    ], this.proxy.gameEventLogger.localNetID, 0);

    this.proxy.sendToClient(clientId, clothingPacket);
    this.sendChat(clientId, "`4[`#Proxy`4]`` `2✓ Outfit applied`` (client-side only)");
    return { handled: true, command: "clothes" };
  }

  cmdSkin(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /skin [colorID] — Change skin color (client-side)");
      return { handled: true, command: "skin" };
    }

    const colorID = parseInt(args[0]) || 0;

    const skinPacket = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnChangeSkin" },
      { type: 9, value: colorID },
    ], this.proxy.gameEventLogger.localNetID, 0);

    this.proxy.sendToClient(clientId, skinPacket);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Skin color set to ${colorID}\`\` (client-side only)`);
    return { handled: true, command: "skin" };
  }

  cmdFlag(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /flag [flagID] — Change flag visual (client-side)");
      return { handled: true, command: "flag" };
    }

    const flagID = parseInt(args[0]) || 0;

    const flagPacket = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnFlagMay2019" },
      { type: 9, value: flagID },
    ], this.proxy.gameEventLogger.localNetID, 0);

    this.proxy.sendToClient(clientId, flagPacket);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Flag set to ${flagID}\`\` (client-side only)`);
    return { handled: true, command: "flag" };
  }

  cmdTitle(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /title [text] — Set title visual (client-side)");
      return { handled: true, command: "title" };
    }

    const title = args.join(" ");
    const titlePacket = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnSetRoleSkinsAndTitles" },
      { type: 2, value: title },
      { type: 9, value: 0 },
    ], this.proxy.gameEventLogger.localNetID, 0);

    this.proxy.sendToClient(clientId, titlePacket);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Title set:\`\` ${title} (client-side only)`);
    return { handled: true, command: "title" };
  }

  cmdName(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /name [text] — Change name display (client-side)");
      return { handled: true, command: "name" };
    }

    const newName = args.join(" ");
    const namePacket = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnNameChanged" },
      { type: 2, value: `\`2${newName}\`\`` },
      { type: 9, value: 0 },
    ], this.proxy.gameEventLogger.localNetID, 0);

    this.proxy.sendToClient(clientId, namePacket);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Name set:\`\` ${newName} (client-side only)`);
    return { handled: true, command: "name" };
  }

  cmdCountry(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /country [code] — e.g. /country us, /country jp (client-side)");
      return { handled: true, command: "country" };
    }

    const code = args[0].toLowerCase();
    const countryPacket = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnCountryState" },
      { type: 2, value: code },
    ], this.proxy.gameEventLogger.localNetID, 0);

    this.proxy.sendToClient(clientId, countryPacket);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Country set:\`\` ${code} (client-side only)`);
    return { handled: true, command: "country" };
  }

  cmdMod(clientId) {
    const gel = this.proxy.gameEventLogger;

    const modName = `\`6@${gel.playerName || "Player"}\`\``;
    const namePacket = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnNameChanged" },
      { type: 2, value: modName },
      { type: 9, value: 0 },
    ], gel.localNetID, 0);

    this.proxy.sendToClient(clientId, namePacket);
    this.sendChat(clientId, "`4[`#Proxy`4]`` `2✓ Mod visual applied`` (client-side only, others can't see)");
    return { handled: true, command: "mod" };
  }

  cmdDev(clientId) {
    const gel = this.proxy.gameEventLogger;

    const devName = `\`b@${gel.playerName || "Player"}\`\``;
    const namePacket = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnNameChanged" },
      { type: 2, value: devName },
      { type: 9, value: 0 },
    ], gel.localNetID, 0);

    this.proxy.sendToClient(clientId, namePacket);
    this.sendChat(clientId, "`4[`#Proxy`4]`` `2✓ Dev visual applied`` (client-side only, others can't see)");
    return { handled: true, command: "dev" };
  }

  cmdReplace(clientId, args) {
    if (args.length < 2) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /replace [fromID] [toID] — Replace tile visuals (client-side)");
      return { handled: true, command: "replace" };
    }

    const fromID = parseInt(args[0]);
    const toID = parseInt(args[1]);

    if (isNaN(fromID) || isNaN(toID)) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid item IDs");
      return { handled: true, command: "replace" };
    }

    this.setUserState(clientId, "replaceFrom", fromID);
    this.setUserState(clientId, "replaceTo", toID);

    this.sendChat(clientId,
      `\`4[\`#Proxy\`4]\`\` \`2✓ Tile replace:\`\` item ${fromID} → ${toID} (client-side)\n` +
      "  Re-enter the world to see changes"
    );
    return { handled: true, command: "replace" };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // HELP
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdHelp(clientId) {
    this.sendChat(clientId,
      "`4[`#dqymon-proxy`4]`` `wv1.0`` — Quick Help\n" +
      "\n" +
      "`w/proxy`` — Full command reference\n" +
      "`w/settings`` — View current settings\n" +
      "`w/server`` — Server info\n" +
      "`w/players`` — List players\n" +
      "`w/growscan`` — World scan\n" +
      "`w/warp [world]`` — Fast warp\n" +
      "`w/drop [amt]`` — Drop DLs\n" +
      "`w/game [amt]`` — Tax calculator\n" +
      "`w/count [wls]`` — Lock breakdown\n" +
      "`w/clothes [ids]`` — Visual outfit\n" +
      "`w/mod`` / `w/dev`` — Visual tags\n" +
      "\n" +
      "Type `w/proxy`` for all commands"
    );
    return { handled: true, command: "help" };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Helpers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /** Build a type-3 action packet */
  buildActionPacket(text) {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(3, 0);
    return Buffer.concat([header, Buffer.from(text, "utf8")]);
  }

  /** Send a world action (wraps common pattern for admin commands) */
  sendWorldAction(clientId, actionText, cmdName, successMsg) {
    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: cmdName };
    }

    const pkt = this.buildActionPacket(actionText);
    this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ ${successMsg}\`\``);
    return { handled: true, command: cmdName };
  }

  /** Send a chat message to the game client via OnConsoleMessage */
  sendChat(clientId, text) {
    const msg = PacketHandler.buildConsoleMessage(text);
    this.proxy.sendToClient(clientId, msg);
  }

  /** Track a dropped/collected item */
  trackItem(action, item, world) {
    this.itemTracker.push({
      time: Date.now(),
      action,
      item,
      world: world || "(unknown)",
    });
    // Keep last 100 entries
    if (this.itemTracker.length > 100) {
      this.itemTracker = this.itemTracker.slice(-100);
    }
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
