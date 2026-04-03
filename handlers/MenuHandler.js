const DialogBuilder = require("../utils/DialogBuilder");
const PacketHandler = require("./PacketHandler");

/**
 * MenuHandler — Manages proxy in-game dialog UI.
 *
 * Sends OnDialogRequest variant packets to inject custom dialogs,
 * and intercepts dialog_return action packets to handle responses.
 *
 * Dialog names are prefixed with "proxy_" to avoid collisions.
 */
class MenuHandler {
  constructor(proxy) {
    this.proxy = proxy;
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Show a dialog to the client. */
  showDialog(clientId, dialogContent) {
    const pkt = PacketHandler.buildVariantPacket([
      { type: 2, value: "OnDialogRequest" },
      { type: 2, value: dialogContent },
    ]);
    this.proxy.sendToClient(clientId, pkt);
  }

  /**
   * Handle a dialog_return from the client.
   * @param {string} clientId
   * @param {object} pairs - key/value from the action packet
   * @returns {boolean} true if this was a proxy dialog (consumed)
   */
  handleDialogReturn(clientId, pairs) {
    const name = pairs.dialog_name || "";
    if (!name.startsWith("proxy_")) return false;

    const buttonClicked = pairs.buttonClicked || "";

    switch (name) {
      case "proxy_menu":        return this._onMainMenu(clientId, buttonClicked, pairs);
      case "proxy_system":      return this._onSystemPanel(clientId, buttonClicked, pairs);
      case "proxy_account":     return this._onAccountPanel(clientId, buttonClicked, pairs);
      case "proxy_navigation":  return this._onNavPanel(clientId, buttonClicked, pairs);
      case "proxy_radar":       return this._onRadarPanel(clientId, buttonClicked, pairs);
      case "proxy_economy":     return this._onEconomyPanel(clientId, buttonClicked, pairs);
      case "proxy_world":       return this._onWorldPanel(clientId, buttonClicked, pairs);
      case "proxy_social":      return this._onSocialPanel(clientId, buttonClicked, pairs);
      case "proxy_visual":      return this._onVisualPanel(clientId, buttonClicked, pairs);
      case "proxy_settings":    return this._onSettingsPanel(clientId, buttonClicked, pairs);
      case "proxy_warp":        return this._onWarpInput(clientId, buttonClicked, pairs);
      case "proxy_tax":         return this._onTaxCalc(clientId, buttonClicked, pairs);
      case "proxy_msg":         return this._onMsgInput(clientId, buttonClicked, pairs);
      default:                  return false;
    }
  }

  // ── Main Menu ──────────────────────────────────────────────────────

  showMainMenu(clientId) {
    const gel = this.proxy.gameEventLogger;
    const world = gel.currentWorld || "Lobby";
    const name = gel.playerName || "Player";
    const players = gel.players.size;
    const gems = gel.lastGems !== undefined ? gel.lastGems : "?";

    const dlg = new DialogBuilder("proxy_menu")
      .setDefaultColor("`o")
      .addLabelBig("`wdqymon-proxy ``\`5v1.0``", 5816)
      .addSmallText(`\`w${name}\`\` in \`w${world}\`\` | \`w${players}\`\` players | \`5${gems}\`\` gems`)
      .addSpacer()
      .addButtonWithIcon("system", "`wCore System``", 6016, "staticBlueFrame")
      .addButtonWithIcon("account", "`wAccount & Login``", 4818, "staticBlueFrame")
      .addButtonWithIcon("navigation", "`wNavigation``", 3002, "staticBlueFrame")
      .addButtonWithIcon("radar", "`wPassive Radar``", 5814, "staticBlueFrame")
      .addButtonWithIcon("economy", "`wEconomy``", 242, "staticBlueFrame")
      .addButtonWithIcon("world", "`wWorld Admin``", 5638, "staticBlueFrame")
      .addButtonWithIcon("social", "`wSocial``", 4994, "staticBlueFrame")
      .addButtonWithIcon("visual", "`wClient Illusions``", 3040, "staticBlueFrame")
      .addSpacer(true)
      .addButtonWithIcon("settings", "`oSettings``", 6, "staticBlueFrame")
      .endDialog("close", "", "Close")
      .build();

    this.showDialog(clientId, dlg);
  }

  // ── Sub Panels ─────────────────────────────────────────────────────

  _showSystemPanel(clientId) {
    const uptime = Math.floor((Date.now() - (this.proxy.startTime || Date.now())) / 1000);
    const h = Math.floor(uptime / 3600); const m = Math.floor((uptime % 3600) / 60); const s = uptime % 60;
    const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    const dlg = new DialogBuilder("proxy_system")
      .setDefaultColor("`o")
      .addLabelBig("`w\u2699\uFE0F Core System``", 6016)
      .addSmallText(`Uptime: \`w${h}h ${m}m ${s}s\`\` | Memory: \`w${mem} MB\`\``)
      .addSpacer(true)
      .addButtonWithIcon("do_ping", "\`wPing\`\` Connection info", 3832, "staticBlueFrame")
      .addButtonWithIcon("do_stats", "\`wStats\`\` Session statistics", 5814, "staticBlueFrame")
      .addButtonWithIcon("do_logs", "\`wLogs\`\` View log paths", 6, "staticBlueFrame")
      .addButtonWithIcon("do_clear", "\`wClear\`\` Clear chat console", 2, "staticBlueFrame")
      .addSpacer(true)
      .addButtonWithIcon("do_hide", "\`5Hide Mode\`\` Suppress proxy logs", 5816, "staticBlueFrame")
      .addButtonWithIcon("do_panic", "\`4Panic\`\` Stop all automations", 5638, "staticBlueFrame")
      .addButtonWithIcon("do_reboot", "\`4Reboot\`\` Reconnect to server", 3040, "staticBlueFrame")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back``")
      .endDialog("close", "", "Close")
      .build();

    this.showDialog(clientId, dlg);
  }

  _showAccountPanel(clientId) {
    const mac = this.proxy.spoofState.enabled ? this.proxy.spoofState.mac : "(unspoofed)";
    const rid = this.proxy.spoofState.enabled ? this.proxy.spoofState.rid.substring(0, 12) + "..." : "N/A";

    const dlg = new DialogBuilder("proxy_account")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83D\uDD11 Account & Login``", 4818)
      .addSmallText(`MAC: \`w${mac}\`\``)
      .addSmallText(`RID: \`w${rid}\`\``)
      .addSpacer(true)
      .addButtonWithIcon("do_switch", "\`wSwitch\`\` Switch account", 4818, "staticBlueFrame")
      .addButtonWithIcon("do_checkacc", "\`wCheck\`\` Account info", 6, "staticBlueFrame")
      .addButtonWithIcon("do_mac", "\`wMAC\`\` Randomize MAC", 3832, "staticBlueFrame")
      .addButtonWithIcon("do_rid", "\`wRID\`\` Randomize RID", 3832, "staticBlueFrame")
      .addButtonWithIcon("do_guest", "\`5Guest\`\` Toggle guest mode", 5816, "staticBlueFrame")
      .addButtonWithIcon("do_relog", "\`wRelog\`\` Quick reconnect", 3040, "staticBlueFrame")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back``")
      .endDialog("close", "", "Close")
      .build();

    this.showDialog(clientId, dlg);
  }

  _showNavPanel(clientId) {
    const gel = this.proxy.gameEventLogger;
    const home = this.proxy.commandHandler.store.get("homeWorld") || "(not set)";
    const saved = (this.proxy.commandHandler.store.get("savedWorlds") || []).length;

    const dlg = new DialogBuilder("proxy_navigation")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83E\uDDED Navigation``", 3002)
      .addSmallText(`World: \`w${gel.currentWorld || "Lobby"}\`\` | Home: \`w${home}\`\` | Saved: \`w${saved}\`\``)
      .addSpacer(true)
      .addTextInput("warp_target", "Warp to world:", "", 24)
      .addButton("do_warp", "`w\u27A1 Warp``")
      .addSpacer(true)
      .addButtonWithIcon("do_home", "\`wHome\`\` Warp to home world", 6016, "staticBlueFrame")
      .addButtonWithIcon("do_back", "\`wBack\`\` Previous saved world", 3002, "staticBlueFrame")
      .addButtonWithIcon("do_rndm", "\`wRandom\`\` Warp to random world", 3832, "staticBlueFrame")
      .addButtonWithIcon("do_tutorial", "\`wSTART\`\` Warp to tutorial", 5814, "staticBlueFrame")
      .addButtonWithIcon("do_sethome", "\`2Set Home\`\` Save current world", 6016, "staticBlueFrame")
      .addSpacer(true)
      .addButtonWithIcon("do_worlds", "\`wSaved Worlds\`\` View list", 6, "staticBlueFrame")
      .addButtonWithIcon("do_history", "\`wHistory\`\` Recent worlds", 6, "staticBlueFrame")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back``")
      .endDialog("do_warp", "", "Close")
      .build();

    this.showDialog(clientId, dlg);
  }

  _showRadarPanel(clientId) {
    const gel = this.proxy.gameEventLogger;
    const playerCount = gel.players.size;
    const owner = gel.worldOwner || "(unknown)";

    // Build player list for display
    let playerList = "";
    let count = 0;
    for (const [netID, info] of gel.players) {
      if (count >= 10) { playerList += `\n  ...+${playerCount - 10} more`; break; }
      const pos = gel.playerPositions.get(netID);
      const posStr = pos ? ` (${Math.floor(pos.x / 32)},${Math.floor(pos.y / 32)})` : "";
      const modTag = info.mstate >= 2 ? " `4[MOD]``" : "";
      const invisTag = info.invis ? " `5[INV]``" : "";
      playerList += `\n  \`w${info.name}\`\`${posStr}${modTag}${invisTag}`;
      count++;
    }

    const dlg = new DialogBuilder("proxy_radar")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83D\uDCE1 Passive Radar``", 5814)
      .addSmallText(`Players: \`w${playerCount}\`\` | Owner: \`w${owner}\`\` | World: \`w${gel.currentWorld || "?"}\`\``)
      .addSmallText(playerList || "  (no players)")
      .addSpacer(true)
      .addButtonWithIcon("do_growscan", "\`wGrowScan\`\` Full world report", 5814, "staticBlueFrame")
      .addButtonWithIcon("do_players", "\`wPlayers\`\` Detailed list", 4994, "staticBlueFrame")
      .addButtonWithIcon("do_mods", "\`4Mod Check\`\` Detect moderators", 5638, "staticBlueFrame")
      .addButtonWithIcon("do_hidden", "\`5Hidden\`\` Show invisible players", 5816, "staticBlueFrame")
      .addButtonWithIcon("do_owner", "\`wOwner\`\` World lock owner", 242, "staticBlueFrame")
      .addButtonWithIcon("do_floating", "\`wFloating\`\` Dropped items", 3832, "staticBlueFrame")
      .addSpacer(true)
      .addTextInput("find_target", "Find player:", "", 24)
      .addButton("do_find", "`w\uD83D\uDD0D Find``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back``")
      .endDialog("do_find", "", "Close")
      .build();

    this.showDialog(clientId, dlg);
  }

  _showEconomyPanel(clientId) {
    const gel = this.proxy.gameEventLogger;
    const gems = gel.lastGems !== undefined ? gel.lastGems : "?";
    const invCount = gel.inventory.size;
    const taxRate = this.proxy.commandHandler.taxRate;

    const dlg = new DialogBuilder("proxy_economy")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83D\uDCB0 Economy``", 242)
      .addSmallText(`Gems: \`5${gems}\`\` | Items: \`w${invCount}\`\` | Tax: \`w${taxRate}%\`\``)
      .addSpacer(true)
      .addButtonWithIcon("do_balance", "\`wBalance\`\` Gem & lock info", 242, "staticBlueFrame")
      .addButtonWithIcon("do_backpack", "\`wBackpack\`\` Inventory list", 6, "staticBlueFrame")
      .addButtonWithIcon("do_upgrade", "\`wUpgrade\`\` Buy backpack slot", 1424, "staticBlueFrame")
      .addSpacer(true)
      .addSmallText("`wTax Calculator``")
      .addTextInput("tax_amount", "WL Amount:", "", 10)
      .addButton("do_calc", "`w\uD83D\uDCCA Calculate``")
      .addSpacer(true)
      .addButtonWithIcon("do_daw", "\`4Drop All WL\`\` Drop world locks", 242, "staticBlueFrame")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back``")
      .endDialog("do_calc", "", "Close")
      .build();

    this.showDialog(clientId, dlg);
  }

  _showWorldPanel(clientId) {
    const dlg = new DialogBuilder("proxy_world")
      .setDefaultColor("`o")
      .addLabelBig("`w\u2694\uFE0F World Admin``", 5638)
      .addSmallText("These send real server commands. Requires world admin.")
      .addSpacer(true)
      .addButtonWithIcon("do_pullall", "\`wPull All\`\`", 5638, "staticBlueFrame")
      .addButtonWithIcon("do_kickall", "\`4Kick All\`\`", 5638, "staticBlueFrame")
      .addButtonWithIcon("do_banall", "\`4Ban All\`\`", 5638, "staticBlueFrame")
      .addButtonWithIcon("do_unall", "\`2Unban All\`\`", 5638, "staticBlueFrame")
      .addButtonWithIcon("do_accessall", "\`wAccess All\`\`", 242, "staticBlueFrame")
      .addButtonWithIcon("do_clearbans", "\`wClear Bans\`\`", 5638, "staticBlueFrame")
      .addButtonWithIcon("do_wbans", "\`wView Bans\`\`", 6, "staticBlueFrame")
      .addSpacer(true)
      .addSmallText("`wWrench Mode:`` " + this.proxy.commandHandler.wrenchMode)
      .addButton("wm_normal", "Normal")
      .addButton("wm_kick", "`4Kick``")
      .addButton("wm_pull", "Pull")
      .addButton("wm_ban", "`4Ban``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back``")
      .endDialog("close", "", "Close")
      .build();

    this.showDialog(clientId, dlg);
  }

  _showSocialPanel(clientId) {
    const filterCount = this.proxy.commandHandler.chatFilters.length;
    const ignoreCount = this.proxy.commandHandler.ignoredPlayers.size;

    const dlg = new DialogBuilder("proxy_social")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83D\uDCAC Social``", 4994)
      .addSmallText(`Filters: \`w${filterCount}\`\` | Ignored: \`w${ignoreCount}\`\``)
      .addSpacer(true)
      .addSmallText("`wSend Message``")
      .addTextInput("msg_target", "Player:", "", 20)
      .addTextInput("msg_text", "Message:", "", 100)
      .addButton("do_msg", "`w\u2709 Send PM``")
      .addSpacer(true)
      .addTextInput("sb_text", "Super Broadcast:", "", 100)
      .addButton("do_sb", "`5\u2728 Broadcast (local)``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back``")
      .endDialog("do_msg", "", "Close")
      .build();

    this.showDialog(clientId, dlg);
  }

  _showVisualPanel(clientId) {
    const ch = this.proxy.commandHandler;
    const isInvis = ch.getUserState(this.proxy.session?.clientId, "invisible");

    const dlg = new DialogBuilder("proxy_visual")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83C\uDFAD Client Illusions``", 3040)
      .addSmallText("These are client-side only. Other players see your real appearance.")
      .addSpacer(true)
      .addButtonWithIcon("do_mod", "\`6@Mod\`\` Moderator visual", 5638, "staticBlueFrame")
      .addButtonWithIcon("do_dev", "\`bDev\`\` Developer visual", 5638, "staticBlueFrame")
      .addButtonWithIcon("do_invis", isInvis ? "\`2Visible\`\` Turn visible" : "\`5Invisible\`\` Turn invisible", 5816, "staticBlueFrame")
      .addButtonWithIcon("do_night", "\`5Night\`\` Dark weather", 3040, "staticBlueFrame")
      .addButtonWithIcon("do_fakeban", "\`4Fake Ban\`\` Show ban overlay", 5638, "staticBlueFrame")
      .addSpacer(true)
      .addSmallText("`wWeather ID:``")
      .addTextInput("weather_id", "Weather:", "0", 5)
      .addButton("do_weather", "`w\u2600\uFE0F Set Weather``")
      .addSpacer(true)
      .addSmallText("`wZoom Level (1-10):``")
      .addTextInput("zoom_level", "Zoom:", "5", 3)
      .addButton("do_zoom", "`w\uD83D\uDD0D Set Zoom``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back``")
      .endDialog("close", "", "Close")
      .build();

    this.showDialog(clientId, dlg);
  }

  _showSettingsPanel(clientId) {
    const ch = this.proxy.commandHandler;
    const store = ch.store;
    const d = store.data;
    const mac = this.proxy.spoofState.enabled ? this.proxy.spoofState.mac : "disabled";
    const saved = (d.savedWorlds || []).length;
    const accounts = (d.accounts || []).length;
    const home = d.homeWorld || "(not set)";
    const taxRate = ch.taxRate;

    const dlg = new DialogBuilder("proxy_settings")
      .setDefaultColor("`o")
      .addLabelBig("`w\u2699\uFE0F Settings``", 6)
      .addSmallText(`MAC: \`w${mac}\`\``)
      .addSmallText(`Home: \`w${home}\`\` | Saved: \`w${saved}\`\` | Accounts: \`w${accounts}\`\``)
      .addSmallText(`Tax Rate: \`w${taxRate}%\`\` | Wrench: \`w${ch.wrenchMode}\`\``)
      .addSmallText(`Guest Mode: \`w${ch.guestMode ? "ON" : "OFF"}\`\``)
      .addSpacer(true)
      .addButtonWithIcon("do_keep", "\`2Save Config\`\` Save settings to disk", 6016, "staticBlueFrame")
      .addButtonWithIcon("do_settings", "\`wView Config\`\` Print all settings", 6, "staticBlueFrame")
      .addSpacer(true)
      .addSmallText("`wSet Tax Rate:``")
      .addTextInput("new_tax", "Tax %:", String(taxRate), 5)
      .addButton("do_settax", "`w\u2714 Set Tax``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back``")
      .endDialog("do_settax", "", "Close")
      .build();

    this.showDialog(clientId, dlg);
  }

  // ── Dialog Response Handlers ───────────────────────────────────────

  _execCmd(clientId, cmd) {
    this.proxy.commandHandler.execute(clientId, `/${cmd}`);
  }

  _onMainMenu(clientId, btn) {
    switch (btn) {
      case "system":      this._showSystemPanel(clientId); break;
      case "account":     this._showAccountPanel(clientId); break;
      case "navigation":  this._showNavPanel(clientId); break;
      case "radar":       this._showRadarPanel(clientId); break;
      case "economy":     this._showEconomyPanel(clientId); break;
      case "world":       this._showWorldPanel(clientId); break;
      case "social":      this._showSocialPanel(clientId); break;
      case "visual":      this._showVisualPanel(clientId); break;
      case "settings":    this._showSettingsPanel(clientId); break;
    }
    return true;
  }

  _onSystemPanel(clientId, btn) {
    switch (btn) {
      case "back":       this.showMainMenu(clientId); break;
      case "do_ping":    this._execCmd(clientId, "ping"); break;
      case "do_stats":   this._execCmd(clientId, "stats"); break;
      case "do_logs":    this._execCmd(clientId, "logs"); break;
      case "do_clear":   this._execCmd(clientId, "clear"); break;
      case "do_hide":    this._execCmd(clientId, "hide"); break;
      case "do_panic":   this._execCmd(clientId, "panic"); break;
      case "do_reboot":  this._execCmd(clientId, "reboot"); break;
    }
    return true;
  }

  _onAccountPanel(clientId, btn) {
    switch (btn) {
      case "back":         this.showMainMenu(clientId); break;
      case "do_switch":    this._execCmd(clientId, "switch"); break;
      case "do_checkacc":  this._execCmd(clientId, "checkacc"); break;
      case "do_mac":       this._execCmd(clientId, "mac random"); break;
      case "do_rid":       this._execCmd(clientId, "rid"); break;
      case "do_guest":     this._execCmd(clientId, "guest"); break;
      case "do_relog":     this._execCmd(clientId, "relog"); break;
    }
    return true;
  }

  _onNavPanel(clientId, btn, pairs) {
    switch (btn) {
      case "back":          this.showMainMenu(clientId); break;
      case "do_warp": {
        const target = (pairs.warp_target || "").trim();
        if (target) this._execCmd(clientId, `warp ${target}`);
        else this._sendChat(clientId, "`4[Proxy]`` Enter a world name first");
        break;
      }
      case "do_home":       this._execCmd(clientId, "home"); break;
      case "do_back":       this._execCmd(clientId, "back"); break;
      case "do_rndm":       this._execCmd(clientId, "rndm"); break;
      case "do_tutorial":   this._execCmd(clientId, "tutorial"); break;
      case "do_sethome":    this._execCmd(clientId, "sethome"); break;
      case "do_worlds":     this._execCmd(clientId, "worlds"); break;
      case "do_history":    this._execCmd(clientId, "history"); break;
    }
    return true;
  }

  _onRadarPanel(clientId, btn, pairs) {
    switch (btn) {
      case "back":          this.showMainMenu(clientId); break;
      case "do_growscan":   this._execCmd(clientId, "growscan"); break;
      case "do_players":    this._execCmd(clientId, "players"); break;
      case "do_mods":       this._execCmd(clientId, "mods"); break;
      case "do_hidden":     this._execCmd(clientId, "hidden"); break;
      case "do_owner":      this._execCmd(clientId, "owner"); break;
      case "do_floating":   this._execCmd(clientId, "floating"); break;
      case "do_find": {
        const target = (pairs.find_target || "").trim();
        if (target) this._execCmd(clientId, `find ${target}`);
        else this._sendChat(clientId, "`4[Proxy]`` Enter a player name first");
        break;
      }
    }
    return true;
  }

  _onEconomyPanel(clientId, btn, pairs) {
    switch (btn) {
      case "back":          this.showMainMenu(clientId); break;
      case "do_balance":    this._execCmd(clientId, "balance"); break;
      case "do_backpack":   this._execCmd(clientId, "backpack"); break;
      case "do_upgrade":    this._execCmd(clientId, "upgrade"); break;
      case "do_daw":        this._execCmd(clientId, "daw"); break;
      case "do_calc": {
        const amount = (pairs.tax_amount || "").trim();
        if (amount && parseInt(amount) > 0) this._execCmd(clientId, `game ${amount}`);
        else this._sendChat(clientId, "`4[Proxy]`` Enter a WL amount");
        break;
      }
    }
    return true;
  }

  _onWorldPanel(clientId, btn) {
    switch (btn) {
      case "back":            this.showMainMenu(clientId); break;
      case "do_pullall":      this._execCmd(clientId, "pullall"); break;
      case "do_kickall":      this._execCmd(clientId, "kickall"); break;
      case "do_banall":       this._execCmd(clientId, "banall"); break;
      case "do_unall":        this._execCmd(clientId, "unall"); break;
      case "do_accessall":    this._execCmd(clientId, "accessall"); break;
      case "do_clearbans":    this._execCmd(clientId, "clearbans"); break;
      case "do_wbans":        this._execCmd(clientId, "wbans"); break;
      case "wm_normal":       this._execCmd(clientId, "wm normal"); this._showWorldPanel(clientId); break;
      case "wm_kick":         this._execCmd(clientId, "wm kick"); this._showWorldPanel(clientId); break;
      case "wm_pull":         this._execCmd(clientId, "wm pull"); this._showWorldPanel(clientId); break;
      case "wm_ban":          this._execCmd(clientId, "wm ban"); this._showWorldPanel(clientId); break;
    }
    return true;
  }

  _onSocialPanel(clientId, btn, pairs) {
    switch (btn) {
      case "back":       this.showMainMenu(clientId); break;
      case "do_msg": {
        const target = (pairs.msg_target || "").trim();
        const text = (pairs.msg_text || "").trim();
        if (target && text) this._execCmd(clientId, `msg ${target} ${text}`);
        else this._sendChat(clientId, "`4[Proxy]`` Enter player name and message");
        break;
      }
      case "do_sb": {
        const text = (pairs.sb_text || "").trim();
        if (text) this._execCmd(clientId, `sb ${text}`);
        else this._sendChat(clientId, "`4[Proxy]`` Enter broadcast text");
        break;
      }
    }
    return true;
  }

  _onVisualPanel(clientId, btn, pairs) {
    switch (btn) {
      case "back":         this.showMainMenu(clientId); break;
      case "do_mod":       this._execCmd(clientId, "mod"); break;
      case "do_dev":       this._execCmd(clientId, "dev"); break;
      case "do_invis":     this._execCmd(clientId, "invis"); break;
      case "do_night":     this._execCmd(clientId, "night"); break;
      case "do_fakeban":   this._execCmd(clientId, "fakeban"); break;
      case "do_weather": {
        const id = (pairs.weather_id || "").trim();
        if (id !== "") this._execCmd(clientId, `weather ${id}`);
        break;
      }
      case "do_zoom": {
        const level = (pairs.zoom_level || "").trim();
        if (level !== "") this._execCmd(clientId, `zoom ${level}`);
        break;
      }
    }
    return true;
  }

  _onSettingsPanel(clientId, btn, pairs) {
    switch (btn) {
      case "back":         this.showMainMenu(clientId); break;
      case "do_keep":      this._execCmd(clientId, "keep"); break;
      case "do_settings":  this._execCmd(clientId, "settings"); break;
      case "do_settax": {
        const rate = (pairs.new_tax || "").trim();
        if (rate !== "") this._execCmd(clientId, `tax ${rate}`);
        break;
      }
    }
    return true;
  }

  // Unused stubs for potential future sub-dialogs
  _onWarpInput() { return true; }
  _onTaxCalc()   { return true; }
  _onMsgInput()  { return true; }

  /** Shortcut to send a chat message */
  _sendChat(clientId, text) {
    const msg = PacketHandler.buildConsoleMessage(text);
    this.proxy.sendToClient(clientId, msg);
  }
}

module.exports = MenuHandler;
