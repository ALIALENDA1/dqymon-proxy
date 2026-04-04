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
    // Automation state
    this.automationTimers = new Map(); // clientId → [intervalIds]
    this.ignoredPlayers = new Set();   // netIDs to ignore chat from
    this.chatFilters = [];             // regex strings to filter
    this.wrenchMode = "normal";        // normal|kick|pull|ban
    this.taxRate = 5;                  // default tax %
    this.guestMode = false;            // strip credentials on next login
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

    let command = commandMatch[1].toLowerCase();
    let args = commandMatch[2].trim().split(/\s+/).filter(Boolean);

    // Type 2 binary packets may append a junk/padding byte to the last
    // token. Try the command as-is first; if it doesn't match any known
    // command, retry with the last character stripped from the appropriate
    // token (command name if no args, last arg otherwise).
    const result = this._dispatch(clientId, command, args);
    if (result) {
      this.logger.info(`[${clientId}] Command: /${command} ${args.join(" ")}`);
      if (command !== "re") {
        this.store.set("lastCommand", `/${command} ${args.join(" ")}`.trim());
        this.store.save();
      }
      return result;
    }

    // Retry with last char stripped (padding byte cleanup)
    if (args.length > 0) {
      const lastArg = args[args.length - 1];
      if (lastArg.length > 1) {
        const cleanArgs = [...args];
        cleanArgs[cleanArgs.length - 1] = lastArg.slice(0, -1);
        const retryResult = this._dispatch(clientId, command, cleanArgs);
        if (retryResult) {
          this.logger.info(`[${clientId}] Command (cleaned arg): /${command} ${cleanArgs.join(" ")}`);
          if (command !== "re") {
            this.store.set("lastCommand", `/${command} ${cleanArgs.join(" ")}`.trim());
            this.store.save();
          }
          return retryResult;
        }
      }
    } else if (command.length > 1) {
      const cleanCmd = command.slice(0, -1);
      const retryResult = this._dispatch(clientId, cleanCmd, args);
      if (retryResult) {
        this.logger.info(`[${clientId}] Command (cleaned cmd): /${cleanCmd}`);
        if (cleanCmd !== "re") {
          this.store.set("lastCommand", `/${cleanCmd}`.trim());
          this.store.save();
        }
        return retryResult;
      }
    }

    return { handled: false };
  }

  _dispatch(clientId, command, args) {
    switch (command) {
      // ─── Group 0: UI Menu ───
      case "menu":
      case "m":       return this.cmdMenu(clientId);

      // ─── Group 1: Core System & Config ───
      case "proxy":   return this.cmdProxy(clientId);
      case "keep":    return this.cmdKeep(clientId);
      case "settings":
      case "options": return this.cmdSettings(clientId);
      case "logs":    return this.cmdLogs(clientId);
      case "help":    return this.cmdHelp(clientId);
      case "clear":   return this.cmdClear(clientId);
      case "ping":    return this.cmdPing(clientId);
      case "stats":   return this.cmdStats(clientId);
      case "hide":    return this.cmdHide(clientId);
      case "panic":   return this.cmdPanic(clientId);
      case "reboot":  return this.cmdReboot(clientId);
      case "exit":    return this.cmdExit(clientId);
      case "re":      return this.cmdRe(clientId);

      // ─── Group 2: Account & Login Routing ───
      case "switch":  return this.cmdSwitch(clientId, args);
      case "account": return this.cmdAccount(clientId, args);
      case "mac":     return this.cmdMac(clientId, args);
      case "rid":     return this.cmdRid(clientId, args);
      case "wk":      return this.cmdWk(clientId, args);
      case "guest":   return this.cmdGuest(clientId);
      case "pass":    return this.cmdPass(clientId, args);
      case "nick":    return this.cmdNick(clientId, args);
      case "relog":   return this.cmdRelog(clientId);
      case "checkacc":return this.cmdCheckacc(clientId);
      case "server":  return this.cmdServer(clientId);

      // ─── Group 3: Navigation & Routing ───
      case "warp":    return this.cmdWarp(clientId, args);
      case "save":    return this.cmdSave(clientId, args);
      case "setsave":
      case "sethome": return this.cmdSethome(clientId);
      case "home":    return this.cmdHome(clientId);
      case "back":    return this.cmdBack(clientId);
      case "rndm":    return this.cmdRndm(clientId);
      case "tutorial":return this.cmdTutorial(clientId);
      case "leave":
      case "logoff":  return this.cmdLogoff(clientId);
      case "door":    return this.cmdDoor(clientId, args);
      case "worlds":  return this.cmdWorlds(clientId);
      case "history": return this.cmdHistory(clientId);

      // ─── Group 4: Passive Radar & Scraping ───
      case "growscan":return this.cmdGrowscan(clientId);
      case "chest":   return this.cmdChest(clientId);
      case "spirit":  return this.cmdSpirit(clientId);
      case "gems":    return this.cmdGems(clientId);
      case "floating":return this.cmdFloating(clientId);
      case "owner":   return this.cmdOwner(clientId);
      case "blocks":  return this.cmdBlocks(clientId);
      case "find":    return this.cmdFind(clientId, args);
      case "hidden":  return this.cmdHidden(clientId);
      case "mods":    return this.cmdMods(clientId);
      case "locate":  return this.cmdLocate(clientId, args);
      case "list":
      case "players": return this.cmdPlayers(clientId);
      case "check":   return this.cmdCheck(clientId);
      case "track":   return this.cmdTrack(clientId, args);

      // ─── Group 5: Economy & UI Bypasses ───
      case "balance": return this.cmdBalance(clientId);
      case "backpack":
      case "inv":     return this.cmdBackpack(clientId);
      case "fastvend":return this.cmdFastvend(clientId, args);
      case "buy":     return this.cmdBuy(clientId, args);
      case "trash":   return this.cmdTrash(clientId, args);
      case "equip":   return this.cmdEquip(clientId, args);
      case "unequip": return this.cmdUnequip(clientId, args);
      case "upgrade": return this.cmdUpgrade(clientId);
      case "drop":
      case "dropdl":
      case "dd":      return this.cmdDrop(clientId, args);
      case "cdrop":   return this.cmdCdrop(clientId, args);
      case "ddrop":   return this.cmdDdrop(clientId, args);
      case "daw":     return this.cmdDaw(clientId);
      case "tax":     return this.cmdTax(clientId, args);
      case "game":    return this.cmdGame(clientId, args);
      case "game1":   return this.cmdGame1(clientId, args);
      case "game2":   return this.cmdGame2(clientId, args);
      case "split":   return this.cmdSplit(clientId, args);
      case "count":   return this.cmdCount(clientId, args);
      case "accept":  return this.cmdAccept(clientId);

      // ─── Group 6: World Admin & Targeting ───
      case "pullall": return this.cmdPullall(clientId);
      case "kickall": return this.cmdKickall(clientId);
      case "banall":  return this.cmdBanall(clientId);
      case "accessall":return this.cmdAccessall(clientId);
      case "unall":   return this.cmdUnall(clientId);
      case "wm":      return this.cmdWm(clientId, args);
      case "wbans":   return this.cmdWbans(clientId);
      case "clearbans":return this.cmdClearbans(clientId);
      case "lock":    return this.cmdLock(clientId, args);
      case "ignore":  return this.cmdIgnore(clientId, args);
      case "level":   return this.cmdLevel(clientId, args);
      case "guild":   return this.cmdGuild(clientId, args);
      case "wrench":  return this.cmdWrench(clientId, args);
      case "trade":   return this.cmdTrade(clientId, args);

      // ─── Group 7: Social ───
      case "msg":     return this.cmdMsg(clientId, args);
      case "sb":      return this.cmdSb(clientId, args);
      case "me":      return this.cmdMe(clientId, args);
      case "copy":    return this.cmdCopy(clientId, args);
      case "filter":  return this.cmdFilter(clientId, args);

      // ─── Group 8: Client-Side Illusions ───
      case "clothes":
      case "outfit":  return this.cmdClothes(clientId, args);
      case "name":    return this.cmdName(clientId, args);
      case "title":
      case "titles":  return this.cmdTitle(clientId, args);
      case "skin":    return this.cmdSkin(clientId, args);
      case "ghost":
      case "invis":   return this.cmdInvis(clientId);
      case "flag":    return this.cmdFlag(clientId, args);
      case "country": return this.cmdCountry(clientId, args);
      case "mod":     return this.cmdMod(clientId);
      case "dev":     return this.cmdDev(clientId);
      case "replace": return this.cmdReplace(clientId, args);
      case "weather": return this.cmdWeather(clientId, args);
      case "night":   return this.cmdNight(clientId);
      case "zoom":    return this.cmdZoom(clientId, args);
      case "fakeban": return this.cmdFakeban(clientId);

      default:        return null;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🏗️ FOUNDATION: State & Configuration
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdMenu(clientId) {
    this.proxy.menuHandler.showMainMenu(clientId);
    return { handled: true, command: "menu" };
  }

  cmdProxy(clientId) {
    this.sendChat(clientId,
      "`4[`#dqymon-proxy`4]`` `wv1.0`` — Full Command Reference\n" +
      "\n" +
      "`w📋 /menu`` — Open interactive UI panel\n" +
      "\n" +
      "`w🏗️ Core System``\n" +
      "`5/help`` /`5proxy`` /`5keep`` /`5settings`` /`5logs`` /`5clear`` /`5ping`` /`5stats``\n" +
      "`5/hide`` /`5panic`` /`5reboot`` /`5exit`` /`5re`` /`5server``\n" +
      "\n" +
      "`w🔑 Account & Login``\n" +
      "`5/switch`` /`5account`` /`5mac`` /`5rid`` /`5wk`` /`5guest`` /`5nick``\n" +
      "`5/relog`` /`5checkacc`` /`5pass``\n" +
      "\n" +
      "`w🧭 Navigation``\n" +
      "`5/warp`` /`5save`` /`5sethome`` /`5home`` /`5back`` /`5rndm``\n" +
      "`5/tutorial`` /`5logoff`` /`5door`` /`5worlds`` /`5history``\n" +
      "\n" +
      "`w📡 Passive Radar``\n" +
      "`5/growscan`` /`5players`` /`5find`` /`5locate`` /`5hidden`` /`5mods``\n" +
      "`5/owner`` /`5floating`` /`5chest`` /`5gems`` /`5spirit`` /`5blocks``\n" +
      "`5/check`` /`5balance`` /`5track``\n" +
      "\n" +
      "`w💰 Economy``\n" +
      "`5/backpack`` /`5fastvend`` /`5buy`` /`5trash`` /`5equip`` /`5unequip``\n" +
      "`5/upgrade`` /`5drop`` /`5cdrop`` /`5ddrop`` /`5daw`` /`5accept``\n" +
      "`5/game`` /`5game1`` /`5game2`` /`5tax`` /`5split`` /`5count``\n" +
      "\n" +
      "`w⚔️ World Admin``\n" +
      "`5/pullall`` /`5kickall`` /`5banall`` /`5unall`` /`5accessall``\n" +
      "`5/wm`` /`5wbans`` /`5clearbans`` /`5lock`` /`5wrench`` /`5trade``\n" +
      "`5/ignore`` /`5level`` /`5guild``\n" +
      "\n" +
      "`w💬 Social``\n" +
      "`5/msg`` /`5me`` /`5sb`` /`5copy`` /`5filter``\n" +
      "\n" +
      "`w🎭 Client Illusions``\n" +
      "`5/clothes`` /`5skin`` /`5name`` /`5title`` /`5flag`` /`5country``\n" +
      "`5/weather`` /`5night`` /`5zoom`` /`5invis`` /`5ghost``\n" +
      "`5/mod`` /`5dev`` /`5replace`` /`5fakeban``"
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

  async cmdDrop(clientId, args) {
    const amount = Math.min(Math.max(parseInt(args[0]) || 1, 1), 200);
    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "drop" };
    }
    const gel = this.proxy.gameEventLogger;
    const before = gel.inventory.get(ITEM.DIAMOND_LOCK) || 0;
    this.logger.debug(`[DROP] Before: ${before} DL`);
    const actionText = `action|drop\n|itemID|${ITEM.DIAMOND_LOCK}\n`;
    const pkt = this.buildActionPacket(actionText);
    for (let i = 0; i < amount; i++) {
      this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    }
    // Wait for inventory update (max 2s)
    let tries = 0;
    let after = before;
    while (tries < 20) {
      await new Promise(r => setTimeout(r, 100));
      after = gel.inventory.get(ITEM.DIAMOND_LOCK) || 0;
      this.logger.debug(`[DROP] Try ${tries + 1}: DL in inv = ${after}`);
      if (after < before) break;
      tries++;
    }
    if (after < before) {
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Dropped ${before - after} Diamond Lock${before - after === 1 ? "" : "s"}\`\``);
    } else if (before >= amount) {
      // Fallback: trust the drop if we had enough DLs and sent the packets
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Drop attempted: ${amount} Diamond Lock${amount === 1 ? "" : "s"} (inventory update not detected, check world)`);
    } else {
      this.sendChat(clientId, "`4[Proxy]`` Drop failed: No Diamond Locks were removed from your inventory.\nPossible reasons: not enough DLs, blocked spot, or server rejected the drop.");
    }
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
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` Usage: /game [wl amount] — Calculates ${this.taxRate}% tax outcome`);
      return { handled: true, command: "game" };
    }

    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid amount");
      return { handled: true, command: "game" };
    }

    const rate = this.taxRate / 100;
    const tax = Math.ceil(amount * rate);
    const net = amount - tax;

    this.sendChat(clientId,
      `\`4[\`#Proxy\`4]\`\` Tax Calculator (${this.taxRate}%):\n` +
      `  \`wAmount:\`\` ${amount} WL\n` +
      `  \`4Tax (${this.taxRate}%):\`\` ${tax} WL\n` +
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
      "`w/menu`` — ⭐ Open interactive UI panel\n" +
      "`w/proxy`` — Full command list (80+ commands)\n" +
      "`w/settings`` — View settings  `w/server`` — Server info\n" +
      "`w/players`` — Player list  `w/find`` — Find player\n" +
      "`w/growscan`` — World scan  `w/locate`` — Player position\n" +
      "`w/warp [world]`` — Warp  `w/home`` — Warp home\n" +
      "`w/drop [amt]`` — Drop DLs  `w/backpack`` — Inventory\n" +
      "`w/game [amt]`` — Tax calc  `w/count`` — Lock breakdown\n" +
      "`w/clothes`` — Visual outfit  `w/invis`` — Invisible\n" +
      "`w/mod`` / `w/dev`` — Visual tags\n" +
      "`w/mods`` — Detect mods  `w/owner`` — World owner\n" +
      "`w/ping`` — Connection  `w/stats`` — Session stats\n" +
      "`w/hide`` — Hide mode  `w/panic`` — Stop all\n" +
      "\n" +
      "Type `w/proxy`` for all commands"
    );
    return { handled: true, command: "help" };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔍 TIER 3: Info & Utility
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdFind(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /find [name] — Search for a player in the current world");
      return { handled: true, command: "find" };
    }

    const query = args.join(" ").toLowerCase();
    const gel = this.proxy.gameEventLogger;
    const matches = [];

    for (const [netID, info] of gel.players) {
      if (info.name.toLowerCase().includes(query)) {
        matches.push(`  \`w${info.name}\`\` ${info.country ? `(${info.country})` : ""} [netID:${netID}]`);
      }
    }

    // Also check self
    if (gel.playerName && gel.playerName.toLowerCase().includes(query)) {
      matches.unshift(`  \`2${gel.playerName}\`\` (you) [netID:${gel.localNetID}]`);
    }

    if (matches.length === 0) {
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` No players matching '\`w${args.join(" ")}\`\`' found`);
    } else {
      this.sendChat(clientId,
        `\`4[\`#Proxy\`4]\`\` Found ${matches.length} player${matches.length === 1 ? "" : "s"} matching '\`w${args.join(" ")}\`\`':\n` +
        matches.join("\n")
      );
    }
    return { handled: true, command: "find" };
  }

  cmdPing(clientId) {
    const session = this.proxy.getSession(clientId);
    if (!session) {
      this.sendChat(clientId, "`4[Proxy]`` No active session");
      return { handled: true, command: "ping" };
    }

    const uptime = Math.floor((Date.now() - (this.proxy.startTime || Date.now())) / 1000);
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const secs = uptime % 60;
    const uptimeStr = `${hours}h ${mins}m ${secs}s`;

    const idle = Math.floor((Date.now() - session.lastActivity) / 1000);
    const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Connection Info:\n" +
      `  \`wServer:\`\` ${session.serverHost}:${session.serverPort}\n` +
      `  \`wUptime:\`\` ${uptimeStr}\n` +
      `  \`wIdle:\`\` ${idle}s\n` +
      `  \`wPackets:\`\` ↑${session.clientPackets} ↓${session.serverPackets}\n` +
      `  \`wTotal:\`\` ↑${this.proxy.totalClientPackets} ↓${this.proxy.totalServerPackets}\n` +
      `  \`wMemory:\`\` ${memMB} MB`
    );
    return { handled: true, command: "ping" };
  }

  cmdStats(clientId) {
    const session = this.proxy.getSession(clientId);
    const gel = this.proxy.gameEventLogger;
    const memUsage = process.memoryUsage();
    const uptime = Math.floor((Date.now() - (this.proxy.startTime || Date.now())) / 1000);
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const secs = uptime % 60;

    const worldHistory = this.store.get("worldHistory") || [];
    const savedWorlds = this.store.get("savedWorlds") || [];
    const accounts = this.store.get("accounts") || [];

    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Session Statistics:\n" +
      `  \`w⏱ Uptime:\`\` ${hours}h ${mins}m ${secs}s\n` +
      `  \`w👤 Player:\`\` ${gel.playerName || "(unknown)"}\n` +
      `  \`w🌍 World:\`\` ${gel.currentWorld || "(none)"}\n` +
      `  \`w👥 Players visible:\`\` ${gel.players.size}\n` +
      `  \`w💎 Gems:\`\` ${gel.lastGems !== undefined ? gel.lastGems : "(unknown)"}\n` +
      `  \`w📦 Packets (session):\`\` ↑${session ? session.clientPackets : 0} ↓${session ? session.serverPackets : 0}\n` +
      `  \`w📦 Packets (total):\`\` ↑${this.proxy.totalClientPackets} ↓${this.proxy.totalServerPackets}\n` +
      `  \`w💾 Memory:\`\` ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)} MB\n` +
      `  \`w📁 Saved worlds:\`\` ${savedWorlds.length}\n` +
      `  \`w📜 World history:\`\` ${worldHistory.length} visits\n` +
      `  \`w🔑 Accounts:\`\` ${accounts.length}\n` +
      `  \`wMAC:\`\` ${this.proxy.spoofState.enabled ? this.proxy.spoofState.mac : "(unspoofed)"}`
    );
    return { handled: true, command: "stats" };
  }

  cmdClear(clientId) {
    // Send a bunch of empty lines to push chat off screen
    const blank = Array(30).fill("").join("\n");
    this.sendChat(clientId, blank);
    this.sendChat(clientId, "`4[`#Proxy`4]`` `2✓ Chat cleared``");
    return { handled: true, command: "clear" };
  }

  cmdSb(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /sb [text] — Fake super broadcast (only you see it)");
      return { handled: true, command: "sb" };
    }

    const text = args.join(" ");
    // OnConsoleMessage with broadcast styling
    this.sendChat(clientId,
      `\`5>>> \`\`\`w${text}\`\` \`5<<<\`\``
    );
    // Also show as text overlay (the big center text)
    const overlayPacket = PacketHandler.buildTextOverlay(
      `\`5>>> \`\`\`w${text}\`\` \`5<<<\`\``
    );
    this.proxy.sendToClient(clientId, overlayPacket);
    return { handled: true, command: "sb" };
  }

  cmdSethome(clientId) {
    let world = this.proxy.gameEventLogger.currentWorld;
    // Fallback: use last joined world from joinHistory if currentWorld is empty
    if (!world) {
      const gel = this.proxy.gameEventLogger;
      if (gel.joinHistory && gel.joinHistory.length > 0) {
        world = gel.joinHistory[gel.joinHistory.length - 1].name;
      }
    }
    if (!world) {
      this.sendChat(clientId, "`4[Proxy]`` You're not in a world");
      return { handled: true, command: "sethome" };
    }
    this.store.set("homeWorld", world);
    this.store.save();
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Home set to:\`\` \`w${world}\`\``);
    return { handled: true, command: "sethome" };
  }

  cmdHome(clientId) {
    const home = this.store.get("homeWorld");
    if (!home) {
      this.sendChat(clientId, "`4[Proxy]`` No home set. Use `w/sethome`` in a world first");
      return { handled: true, command: "home" };
    }

    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected to server");
      return { handled: true, command: "home" };
    }

    const actionText = `action|join_request\nname|${home}\ninvitedWorld|0\n`;
    const pkt = this.buildActionPacket(actionText);
    this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2Warping home →\`\` \`w${home}\`\``);
    return { handled: true, command: "home" };
  }

  cmdWorlds(clientId) {
    const saved = this.store.get("savedWorlds") || [];
    const home = this.store.get("homeWorld");

    if (saved.length === 0 && !home) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` No saved worlds.\n  `w/save [name]`` — Save current world\n  `w/sethome`` — Set home world");
      return { handled: true, command: "worlds" };
    }

    let msg = "`4[`#Proxy`4]`` Saved Worlds:\n";
    if (home) {
      msg += `  \`2🏠 Home:\`\` \`w${home}\`\`\n`;
    }
    if (saved.length > 0) {
      const list = saved.map((w, i) => {
        const ago = Math.floor((Date.now() - w.savedAt) / 60000);
        const timeStr = ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`;
        return `  ${i + 1}. \`w${w.world}\`\`${w.label !== w.world ? ` (${w.label})` : ""} — ${timeStr}`;
      });
      msg += list.join("\n");
    }
    msg += "\n  Use \`w/warp [world]\`\` or \`w/home\`\` to teleport";

    this.sendChat(clientId, msg);
    return { handled: true, command: "worlds" };
  }

  cmdHistory(clientId) {
    const history = this.store.get("worldHistory") || [];

    if (history.length === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` No world history yet — join some worlds first");
      return { handled: true, command: "history" };
    }

    const recent = history.slice(-15).reverse();
    const lines = recent.map((entry, i) => {
      const ago = Math.floor((Date.now() - entry.time) / 1000);
      let timeStr;
      if (ago < 60) timeStr = `${ago}s ago`;
      else if (ago < 3600) timeStr = `${Math.floor(ago / 60)}m ago`;
      else timeStr = `${Math.floor(ago / 3600)}h ${Math.floor((ago % 3600) / 60)}m ago`;
      return `  ${i + 1}. \`w${entry.world}\`\` — ${timeStr}`;
    });

    this.sendChat(clientId,
      `\`4[\`#Proxy\`4]\`\` Recent worlds (${recent.length}):\n` + lines.join("\n")
    );
    return { handled: true, command: "history" };
  }

  cmdCopy(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /copy [name] — Copy a player's visual appearance (client-side)");
      return { handled: true, command: "copy" };
    }

    const query = args.join(" ").toLowerCase();
    const gel = this.proxy.gameEventLogger;
    let targetNetID = -1;
    let targetName = null;

    for (const [netID, info] of gel.players) {
      if (info.name.toLowerCase().includes(query)) {
        targetNetID = netID;
        targetName = info.name;
        break;
      }
    }

    if (targetNetID === -1) {
      this.sendChat(clientId, `\`4[Proxy]\`\` Player '\`w${args.join(" ")}\`\`' not found in world`);
      return { handled: true, command: "copy" };
    }

    // Send OnCopyClothing-style: set name + request the client to copy
    const namePacket = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnNameChanged" },
      { type: 2, value: `\`2${targetName}\`\`` },
      { type: 9, value: 0 },
    ], gel.localNetID, 0);
    this.proxy.sendToClient(clientId, namePacket);

    this.sendChat(clientId,
      `\`4[\`#Proxy\`4]\`\` \`2✓ Copied name from:\`\` \`w${targetName}\`\` [netID:${targetNetID}]\n` +
      "  `wNote:`` Outfit copy requires re-entering world (client-side only)"
    );
    return { handled: true, command: "copy" };
  }

  cmdWeather(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId,
        "`4[`#Proxy`4]`` Usage: /weather [id] — Change weather visually\n" +
        "  Common IDs: `w0`` None, `w1`` Rain, `w2`` Sunny, `w3`` Wind,\n" +
        "  `w4`` Mars, `w5`` Toxic, `w6`` Heatwave, `w7`` Meteor,\n" +
        "  `w8`` Snow, `w9`` Harvest, `w10`` Nether, `w11`` Comet,\n" +
        "  `w12`` Holiday, `w18`` Rayman, `w19`` Love, `w20`` StPatrick,\n" +
        "  `w21`` Pineapple, `w22`` Alien, `w23`` Carnival, `w24`` Summer\n" +
        "  `w(client-side only — others see normal weather)``"
      );
      return { handled: true, command: "weather" };
    }

    const weatherID = parseInt(args[0]);
    if (isNaN(weatherID) || weatherID < 0) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid weather ID");
      return { handled: true, command: "weather" };
    }

    // OnSetCurrentWeather(int weatherID)
    const weatherPacket = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnSetCurrentWeather" },
      { type: 9, value: weatherID },
    ], -1, 0);

    this.proxy.sendToClient(clientId, weatherPacket);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Weather set to ${weatherID}\`\` (client-side only)`);
    return { handled: true, command: "weather" };
  }

  cmdInvis(clientId) {
    const gel = this.proxy.gameEventLogger;
    const isInvis = this.getUserState(clientId, "invisible");

    if (isInvis) {
      // Turn off — reset alpha by sending OnSetClothing with all 0s
      // (forces client to re-render with normal visibility)
      this.setUserState(clientId, "invisible", false);

      const resetPacket = PacketHandler.buildVariantPacket([
        { type: 2, value: "OnSkinColor" },
        { type: 9, value: 0x78787878 }, // default gray skin
      ], gel.localNetID, 0);
      this.proxy.sendToClient(clientId, resetPacket);

      this.sendChat(clientId, "`4[`#Proxy`4]`` \`2Invisible OFF\`\` — you are visible again (client-side)");
    } else {
      // Turn on — set alpha to near-transparent
      this.setUserState(clientId, "invisible", true);

      const invisPacket = PacketHandler.buildVariantPacket([
        { type: 2, value: "OnSkinColor" },
        { type: 9, value: 0x10FFFFFF }, // near-transparent white
      ], gel.localNetID, 0);
      this.proxy.sendToClient(clientId, invisPacket);

      this.sendChat(clientId, "`4[`#Proxy`4]`` \`5Invisible ON\`\` — you appear invisible to yourself (client-side only, others still see you)");
    }
    return { handled: true, command: "invis" };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🆕 NEW: Core System
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdHide(clientId) {
    const hidden = !this.getUserState(clientId, "hidden");
    this.setUserState(clientId, "hidden", hidden);
    this.sendChat(clientId, hidden
      ? "`4[`#Proxy`4]`` `5Hidden mode ON`` — proxy logs suppressed"
      : "`4[`#Proxy`4]`` `2Hidden mode OFF`` — normal logging");
    return { handled: true, command: "hide" };
  }

  cmdPanic(clientId) {
    for (const [, timers] of this.automationTimers) {
      for (const t of timers) clearInterval(t);
    }
    this.automationTimers.clear();
    this.sendChat(clientId, "`4[`#Proxy`4]`` `2✓ PANIC`` — All automations stopped");
    return { handled: true, command: "panic" };
  }

  cmdReboot(clientId) {
    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected");
      return { handled: true, command: "reboot" };
    }
    this.sendChat(clientId, "`4[`#Proxy`4]`` `5Rebooting...``");
    const pkt = this.buildActionPacket("action|quit\n");
    this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    return { handled: true, command: "reboot" };
  }

  cmdExit(clientId) {
    this.sendChat(clientId, "`4[`#Proxy`4]`` `4Shutting down...``");
    setTimeout(() => process.exit(0), 500);
    return { handled: true, command: "exit" };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🆕 NEW: Account & Login
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdRid(clientId, args) {
    const rid = args[0] || crypto.randomBytes(16).toString("hex").toUpperCase();
    if (this.proxy.spoofState.enabled) this.proxy.spoofState.rid = rid;
    this.store.data.spoof.rid = rid;
    this.store.save();
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ RID:\`\` \`w${rid.substring(0, 16)}...\`\` — active now`);
    return { handled: true, command: "rid" };
  }

  cmdWk(clientId, args) {
    const wk = args[0] || crypto.randomBytes(16).toString("hex").toUpperCase();
    if (this.proxy.spoofState.enabled) this.proxy.spoofState.hash = parseInt(wk.substring(0, 8), 16) || 0;
    this.store.data.spoof.wk = wk;
    this.store.save();
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ WK/Hash:\`\` \`w${wk.substring(0, 16)}...\`\` — active now`);
    return { handled: true, command: "wk" };
  }

  cmdGuest(clientId) {
    this.guestMode = !this.guestMode;
    this.sendChat(clientId, this.guestMode
      ? "`4[`#Proxy`4]`` `5Guest mode ON`` — credentials stripped on next login"
      : "`4[`#Proxy`4]`` `2Guest mode OFF`` — normal login");
    return { handled: true, command: "guest" };
  }

  cmdCheckacc(clientId) {
    const gel = this.proxy.gameEventLogger;
    const d = gel.lastLoginResponse;
    if (!d) {
      this.sendChat(clientId, "`4[Proxy]`` No login data — relog to capture");
      return { handled: true, command: "checkacc" };
    }
    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Login Info:\n" +
      `  \`wName:\`\` ${d.tankIDName || d.requestedName || "(guest)"}\n` +
      `  \`wCountry:\`\` ${d.country || "?"}\n` +
      `  \`wPlatform:\`\` ${d.platformID || "?"}\n` +
      `  \`wMAC:\`\` ${d.mac || "?"}\n` +
      `  \`wRID:\`\` ${d.rid ? d.rid.substring(0, 16) + "..." : "?"}`
    );
    return { handled: true, command: "checkacc" };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🆕 NEW: Navigation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdTutorial(clientId) {
    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected");
      return { handled: true, command: "tutorial" };
    }
    const pkt = this.buildActionPacket("action|join_request\nname|START\ninvitedWorld|0\n");
    this.proxy.outgoingClient.send(session.serverNetID, 0, pkt);
    this.sendChat(clientId, "`4[`#Proxy`4]`` `2Warping to START``");
    return { handled: true, command: "tutorial" };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🆕 NEW: Passive Radar
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdSpirit(clientId) {
    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Spirit Board:\n" +
      "  Spirit board text is captured from dialog packets.\n" +
      "  Check `w/logs`` for captured dialog content."
    );
    return { handled: true, command: "spirit" };
  }

  cmdFloating(clientId) {
    const gel = this.proxy.gameEventLogger;
    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Floating Items:\n" +
      `  \`wTracked:\`\` ${gel.droppedItems.size}\n` +
      `  \`wWorld:\`\` ${gel.currentWorld || "(none)"}`
    );
    return { handled: true, command: "floating" };
  }

  cmdOwner(clientId) {
    const gel = this.proxy.gameEventLogger;
    this.sendChat(clientId,
      "`4[`#Proxy`4]`` World Owner:\n" +
      `  \`wWorld:\`\` ${gel.currentWorld || "(none)"}\n` +
      `  \`wOwner:\`\` ${gel.worldOwner || "(unknown/unlocked)"}`
    );
    return { handled: true, command: "owner" };
  }

  cmdBlocks(clientId) {
    this.sendChat(clientId,
      "`4[`#Proxy`4]`` Block analysis requires map data parsing.\n" +
      "  Tile changes are logged via `w/track on``."
    );
    return { handled: true, command: "blocks" };
  }

  cmdMods(clientId) {
    const gel = this.proxy.gameEventLogger;
    const mods = [];
    for (const [netID, info] of gel.players) {
      if (info.mstate >= 2) mods.push(`  \`4⚠ ${info.name}\`\` [${netID}] mstate=${info.mstate}`);
    }
    this.sendChat(clientId, mods.length > 0
      ? `\`4[\`#Proxy\`4]\`\` \`4Mods detected (${mods.length}):\`\`\n` + mods.join("\n")
      : "`4[`#Proxy`4]`` `2No moderators detected``"
    );
    return { handled: true, command: "mods" };
  }

  cmdLocate(clientId, args) {
    if (args.length === 0) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /locate [name]");
      return { handled: true, command: "locate" };
    }
    const q = args.join(" ").toLowerCase();
    const gel = this.proxy.gameEventLogger;
    for (const [netID, info] of gel.players) {
      if (info.name.toLowerCase().includes(q)) {
        const pos = gel.playerPositions.get(netID);
        this.sendChat(clientId, pos
          ? `\`4[\`#Proxy\`4]\`\` \`w${info.name}\`\`: tile (${Math.floor(pos.x / 32)}, ${Math.floor(pos.y / 32)}) px (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`
          : `\`4[\`#Proxy\`4]\`\` \`w${info.name}\`\` — no position data`
        );
        return { handled: true, command: "locate" };
      }
    }
    this.sendChat(clientId, `\`4[Proxy]\`\` '\`w${args.join(" ")}\`\`' not found`);
    return { handled: true, command: "locate" };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🆕 NEW: Economy
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdBackpack(clientId) {
    const gel = this.proxy.gameEventLogger;
    if (gel.inventory.size === 0) {
      this.sendChat(clientId, "`4[Proxy]`` Inventory empty or not loaded — enter a world");
      return { handled: true, command: "backpack" };
    }
    const items = [];
    for (const [id, count] of gel.inventory) items.push(`  ID:\`w${id}\`\` x${count}`);
    this.sendChat(clientId,
      `\`4[\`#Proxy\`4]\`\` Backpack (${gel.inventory.size} items):\n` +
      items.slice(0, 30).join("\n") +
      (items.length > 30 ? `\n  ...+${items.length - 30} more` : "")
    );
    return { handled: true, command: "backpack" };
  }

  cmdEquip(clientId, args) {
    if (!args[0]) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /equip [itemID]");
      return { handled: true, command: "equip" };
    }
    const id = parseInt(args[0]);
    if (!id || id <= 0) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid item ID");
      return { handled: true, command: "equip" };
    }
    return this.sendWorldAction(clientId, `action|wear\n|itemID|${id}\n`, "equip", `Equip sent: item ${id}`);
  }

  cmdUnequip(clientId, args) {
    if (!args[0]) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /unequip [itemID]");
      return { handled: true, command: "unequip" };
    }
    const id = parseInt(args[0]);
    if (!id || id <= 0) {
      this.sendChat(clientId, "`4[Proxy]`` Invalid item ID");
      return { handled: true, command: "unequip" };
    }
    return this.sendWorldAction(clientId, `action|unwear\n|itemID|${id}\n`, "unequip", `Unequip sent: item ${id}`);
  }

  cmdUpgrade(clientId) {
    return this.sendWorldAction(clientId, "action|buy\n|itemID|1424\n|count|1\n", "upgrade", "Backpack upgrade sent");
  }

  cmdDaw(clientId) {
    const gel = this.proxy.gameEventLogger;
    const wlCount = gel.inventory.get(ITEM.WORLD_LOCK) || 0;
    if (wlCount === 0) {
      this.sendChat(clientId, "`4[Proxy]`` No WLs in inventory (or not loaded)");
      return { handled: true, command: "daw" };
    }
    const count = Math.min(wlCount, 200);
    return this.sendWorldAction(clientId, `action|drop\n|itemID|${ITEM.WORLD_LOCK}\n|count|${count}\n`, "daw", `Dropping ${count} World Locks`);
  }

  cmdTax(clientId, args) {
    if (!args[0]) {
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` Tax rate: \`w${this.taxRate}%\`\`\n  Usage: /tax [0-100]`);
      return { handled: true, command: "tax" };
    }
    const rate = parseFloat(args[0]);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      this.sendChat(clientId, "`4[Proxy]`` Rate must be 0-100");
      return { handled: true, command: "tax" };
    }
    this.taxRate = rate;
    this.store.data.taxRate = rate;
    this.store.save();
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Tax rate: ${rate}%\`\``);
    return { handled: true, command: "tax" };
  }

  cmdAccept(clientId) {
    return this.sendWorldAction(clientId, "action|dialog_return\ndialog_name|trade_accept\n", "accept", "Trade accept sent");
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🆕 NEW: World Admin
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdAccessall(clientId) {
    return this.sendWorldAction(clientId, "action|input\n|text|/accessall\n", "accessall", "Access all sent");
  }

  cmdWm(clientId, args) {
    const modes = ["normal", "kick", "pull", "ban"];
    if (!args[0]) {
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` Wrench mode: \`w${this.wrenchMode}\`\`\n  Options: ${modes.join(", ")}`);
      return { handled: true, command: "wm" };
    }
    const mode = args[0].toLowerCase();
    if (!modes.includes(mode)) {
      this.sendChat(clientId, `\`4[Proxy]\`\` Invalid. Options: ${modes.join(", ")}`);
      return { handled: true, command: "wm" };
    }
    this.wrenchMode = mode;
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Wrench mode: ${mode}\`\``);
    return { handled: true, command: "wm" };
  }

  cmdWbans(clientId) {
    return this.sendWorldAction(clientId, "action|input\n|text|/bans\n", "wbans", "Ban list requested");
  }

  cmdClearbans(clientId) {
    return this.sendWorldAction(clientId, "action|input\n|text|/unbanall\n", "clearbans", "All bans cleared");
  }

  cmdLock(clientId, args) {
    if (!args[0]) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /lock [wl|dl|sl|bl|bgl]");
      return { handled: true, command: "lock" };
    }
    const map = { wl: ITEM.WORLD_LOCK, dl: ITEM.DIAMOND_LOCK, sl: ITEM.SMALL_LOCK, bl: ITEM.BIG_LOCK, bgl: ITEM.BLUE_GEM_LOCK };
    const itemID = map[args[0].toLowerCase()];
    if (!itemID) {
      this.sendChat(clientId, "`4[Proxy]`` Types: wl, dl, sl, bl, bgl");
      return { handled: true, command: "lock" };
    }
    const session = this.proxy.getSession(clientId);
    if (!session || !session.connected || session.serverNetID === null) {
      this.sendChat(clientId, "`4[Proxy]`` Not connected");
      return { handled: true, command: "lock" };
    }
    const gel = this.proxy.gameEventLogger;
    const pos = gel.playerPositions.get(gel.localNetID) || { x: 0, y: 0 };
    const tx = Math.floor(pos.x / 32);
    const ty = Math.floor(pos.y / 32) + 1;
    const tank = Buffer.alloc(60);
    tank.writeUInt32LE(4, 0);
    tank.writeUInt8(3, 4);
    tank.writeInt32LE(gel.localNetID, 8);
    tank.writeUInt16LE(itemID, 20);
    tank.writeInt32LE(tx, 48);
    tank.writeInt32LE(ty, 52);
    this.proxy.outgoingClient.send(session.serverNetID, 0, tank);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Lock place sent:\`\` ${args[0].toUpperCase()} at (${tx}, ${ty})`);
    return { handled: true, command: "lock" };
  }

  cmdIgnore(clientId, args) {
    if (!args[0]) {
      const list = this.ignoredPlayers.size > 0
        ? [...this.ignoredPlayers].map(n => `  \`w${n}\`\``).join("\n")
        : "  (none)";
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` Ignored (${this.ignoredPlayers.size}):\n${list}\n  /ignore [name] to toggle`);
      return { handled: true, command: "ignore" };
    }
    const name = args.join(" ");
    if (this.ignoredPlayers.has(name)) {
      this.ignoredPlayers.delete(name);
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Unignored:\`\` ${name}`);
    } else {
      this.ignoredPlayers.add(name);
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Ignoring:\`\` ${name}`);
    }
    return { handled: true, command: "ignore" };
  }

  cmdLevel(clientId, args) {
    const gel = this.proxy.gameEventLogger;
    if (!args[0]) {
      const list = [];
      for (const [, info] of gel.players) {
        if (info.level) list.push(`  \`w${info.name}\`\` — Lv.${info.level}`);
      }
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` Levels:\n${list.length > 0 ? list.join("\n") : "  No data — re-enter world"}`);
      return { handled: true, command: "level" };
    }
    const q = args.join(" ").toLowerCase();
    for (const [, info] of gel.players) {
      if (info.name.toLowerCase().includes(q)) {
        this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`w${info.name}\`\` — Level ${info.level || "?"}`);
        return { handled: true, command: "level" };
      }
    }
    this.sendChat(clientId, `\`4[Proxy]\`\` '\`w${args.join(" ")}\`\`' not found`);
    return { handled: true, command: "level" };
  }

  cmdGuild(clientId, args) {
    const gel = this.proxy.gameEventLogger;
    if (!args[0]) {
      const list = [];
      for (const [, info] of gel.players) {
        if (info.guild) list.push(`  \`w${info.name}\`\` — \`5${info.guild}\`\``);
      }
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` Guilds:\n${list.length > 0 ? list.join("\n") : "  No guild data"}`);
      return { handled: true, command: "guild" };
    }
    const q = args.join(" ").toLowerCase();
    for (const [, info] of gel.players) {
      if (info.name.toLowerCase().includes(q)) {
        this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`w${info.name}\`\` — Guild: ${info.guild || "(none)"}`);
        return { handled: true, command: "guild" };
      }
    }
    this.sendChat(clientId, `\`4[Proxy]\`\` '\`w${args.join(" ")}\`\`' not found`);
    return { handled: true, command: "guild" };
  }

  cmdWrench(clientId, args) {
    if (!args[0]) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /wrench [name]");
      return { handled: true, command: "wrench" };
    }
    const q = args.join(" ").toLowerCase();
    const gel = this.proxy.gameEventLogger;
    for (const [netID, info] of gel.players) {
      if (info.name.toLowerCase().includes(q)) {
        return this.sendWorldAction(clientId, `action|wrench\n|netID|${netID}\n`, "wrench", `Wrenched ${info.name}`);
      }
    }
    this.sendChat(clientId, `\`4[Proxy]\`\` '\`w${args.join(" ")}\`\`' not found`);
    return { handled: true, command: "wrench" };
  }

  cmdTrade(clientId, args) {
    if (!args[0]) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /trade [name]");
      return { handled: true, command: "trade" };
    }
    return this.sendWorldAction(clientId, `action|input\n|text|/trade ${args.join(" ")}\n`, "trade", `Trade sent to ${args.join(" ")}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🆕 NEW: Social
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdMsg(clientId, args) {
    if (args.length < 2) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /msg [name] [text]");
      return { handled: true, command: "msg" };
    }
    const target = args[0];
    const text = args.slice(1).join(" ");
    return this.sendWorldAction(clientId, `action|input\n|text|/msg ${target} ${text}\n`, "msg", `PM → ${target}`);
  }

  cmdMe(clientId, args) {
    if (!args[0]) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /me [text]");
      return { handled: true, command: "me" };
    }
    return this.sendWorldAction(clientId, `action|input\n|text|/me ${args.join(" ")}\n`, "me", `Action: /me ${args.join(" ")}`);
  }

  cmdFilter(clientId, args) {
    if (!args[0]) {
      const list = this.chatFilters.length > 0
        ? this.chatFilters.map((f, i) => `  ${i + 1}. \`w${f}\`\``).join("\n")
        : "  (none)";
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` Filters (${this.chatFilters.length}):\n${list}\n  /filter [word] toggle | /filter clear`);
      return { handled: true, command: "filter" };
    }
    if (args[0].toLowerCase() === "clear") {
      this.chatFilters = [];
      this.sendChat(clientId, "`4[`#Proxy`4]`` `2✓ Filters cleared``");
      return { handled: true, command: "filter" };
    }
    const word = args.join(" ").toLowerCase();
    const idx = this.chatFilters.indexOf(word);
    if (idx !== -1) {
      this.chatFilters.splice(idx, 1);
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Removed:\`\` ${word}`);
    } else {
      this.chatFilters.push(word);
      this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Filtering:\`\` ${word}`);
    }
    return { handled: true, command: "filter" };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🆕 NEW: Client Illusions
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cmdNight(clientId) {
    const pkt = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnSetCurrentWeather" },
      { type: 9, value: 10 },
    ], -1, 0);
    this.proxy.sendToClient(clientId, pkt);
    this.sendChat(clientId, "`4[`#Proxy`4]`` `2✓ Night mode`` (client-side)");
    return { handled: true, command: "night" };
  }

  cmdZoom(clientId, args) {
    if (!args[0]) {
      this.sendChat(clientId, "`4[`#Proxy`4]`` Usage: /zoom [1-10]");
      return { handled: true, command: "zoom" };
    }
    const level = Math.min(Math.max(parseInt(args[0]) || 5, 1), 10);
    const pkt = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnZoomCamera" },
      { type: 1, value: level * 1000.0 },
      { type: 9, value: 0 },
    ], -1, 0);
    this.proxy.sendToClient(clientId, pkt);
    this.sendChat(clientId, `\`4[\`#Proxy\`4]\`\` \`2✓ Zoom: ${level}\`\` (client-side)`);
    return { handled: true, command: "zoom" };
  }

  cmdFakeban(clientId) {
    const pkt = PacketHandler.buildTextOverlay(
      "`4WARNING:`` `wYou have been banned.\nReason: Breaking rules.\nDays: 730``"
    );
    this.proxy.sendToClient(clientId, pkt);
    this.sendChat(clientId, "`4[`#Proxy`4]`` `2✓ Fake ban shown`` (you're NOT banned)");
    return { handled: true, command: "fakeban" };
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
