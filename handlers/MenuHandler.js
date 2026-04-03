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
      // Picker sub-dialogs
      case "proxy_weather":     return this._onWeatherPicker(clientId, buttonClicked, pairs);
      case "proxy_skin":        return this._onSkinPicker(clientId, buttonClicked, pairs);
      case "proxy_flag":        return this._onFlagPicker(clientId, buttonClicked, pairs);
      case "proxy_zoom":        return this._onZoomPicker(clientId, buttonClicked, pairs);
      case "proxy_outfit":      return this._onOutfitEditor(clientId, buttonClicked, pairs);
      case "proxy_drop":        return this._onDropPicker(clientId, buttonClicked, pairs);
      case "proxy_lock":        return this._onLockPicker(clientId, buttonClicked, pairs);
      case "proxy_equip":       return this._onEquipPicker(clientId, buttonClicked, pairs);
      case "proxy_trash_dlg":   return this._onTrashPicker(clientId, buttonClicked, pairs);
      case "proxy_buy_dlg":     return this._onBuyPicker(clientId, buttonClicked, pairs);
      case "proxy_fastvend_dlg":return this._onFastvendPicker(clientId, buttonClicked, pairs);
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
      .addButtonWithIcon("open_drop", "\`w\u2B07 Drop Picker\`\` Drop locks with chooser", 242, "staticBlueFrame")
      .addButtonWithIcon("open_lock", "\`w\uD83D\uDD12 Lock Placer\`\` Place lock at feet", 202, "staticBlueFrame")
      .addButtonWithIcon("open_equip", "\`w\uD83D\uDC55 Equip/Unequip\`\` Wear or remove items", 4994, "staticBlueFrame")
      .addButtonWithIcon("open_buy", "\`w\uD83D\uDED2 Buy Item\`\` Buy from store", 1424, "staticBlueFrame")
      .addButtonWithIcon("open_trash", "\`w\uD83D\uDDD1 Trash Item\`\` Delete from inventory", 5638, "staticBlueFrame")
      .addButtonWithIcon("open_fastvend", "\`w\u26A1 Fast Vend\`\` Quick buy/sell", 3832, "staticBlueFrame")
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
      .addButtonWithIcon("do_fakeban", "\`4Fake Ban\`\` Show ban overlay", 5638, "staticBlueFrame")
      .addSpacer(true)
      .addButtonWithIcon("open_weather", "\`w\u2600\uFE0F Weather Picker\`\` Choose weather effect", 3040, "staticBlueFrame")
      .addButtonWithIcon("open_zoom", "\`w\uD83D\uDD0D Zoom Picker\`\` Set camera zoom level", 5814, "staticBlueFrame")
      .addButtonWithIcon("open_skin", "\`w\uD83C\uDFA8 Skin Color\`\` Change skin color", 4818, "staticBlueFrame")
      .addButtonWithIcon("open_flag", "\`w\uD83C\uDFF3 Flag Picker\`\` Change country flag", 3002, "staticBlueFrame")
      .addButtonWithIcon("open_outfit", "\`w\uD83D\uDC55 Outfit Editor\`\` Change clothing slots", 4994, "staticBlueFrame")
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

  // ── Picker Sub-Dialogs ──────────────────────────────────────────────

  _showWeatherPicker(clientId) {
    const weathers = [
      [0, "None"], [1, "Rain"], [2, "Sunny"], [3, "Wind"], [4, "Mars"],
      [5, "Toxic"], [6, "Heatwave"], [7, "Meteor"], [8, "Snow"], [9, "Harvest"],
      [10, "Nether"], [11, "Comet"], [12, "Holiday"],
      [18, "Rayman"], [19, "Love"], [20, "St.Patrick"], [21, "Pineapple"],
      [22, "Alien"], [23, "Carnival"], [24, "Summer"],
    ];
    const dlg = new DialogBuilder("proxy_weather")
      .setDefaultColor("`o")
      .addLabelBig("`w\u2600\uFE0F Weather Picker``", 3040)
      .addSmallText("Select a weather effect (client-side only)");

    for (const [id, name] of weathers) {
      dlg.addButton(`w_${id}`, `\`w${name}\`\` (${id})`);
    }

    dlg.addSpacer(true)
      .addSmallText("`wCustom ID:``")
      .addTextInput("custom_id", "Weather ID:", "", 5)
      .addButton("w_custom", "`w\u2714 Apply Custom``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back to Visual``")
      .endDialog("w_custom", "", "Close");

    this.showDialog(clientId, dlg.build());
  }

  _showSkinPicker(clientId) {
    const skins = [
      [0x78787878, "Default"],
      [0xFFF0D0B0, "Pale"],
      [0xFFC89678, "Light"],
      [0xFFA87858, "Medium"],
      [0xFF886838, "Tan"],
      [0xFF583818, "Dark"],
      [0xFF382808, "Brown"],
      [0x10FFFFFF, "Ghost"],
      [0xFFFF0000, "Red"],
      [0xFF00FF00, "Green"],
      [0xFF0000FF, "Blue"],
      [0xFFFFFF00, "Yellow"],
      [0xFFFF69B4, "Pink"],
      [0xFFFFFFFF, "White"],
      [0xFF000000, "Black"],
    ];
    const dlg = new DialogBuilder("proxy_skin")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83C\uDFA8 Skin Color``", 4818)
      .addSmallText("Change your skin color (client-side only)");

    for (const [id, name] of skins) {
      dlg.addButton(`s_${id}`, `\`w${name}\`\``);
    }

    dlg.addSpacer(true)
      .addSmallText("`wCustom Color ID:``")
      .addTextInput("custom_skin", "Color ID:", "", 12)
      .addButton("s_custom", "`w\u2714 Apply Custom``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back to Visual``")
      .endDialog("s_custom", "", "Close");

    this.showDialog(clientId, dlg.build());
  }

  _showFlagPicker(clientId) {
    const flags = [
      [164, "US"], [162, "UK"], [99, "Japan"], [114, "Korea"], [26, "Brazil"],
      [57, "France"], [53, "Finland"], [45, "Egypt"], [66, "Germany"],
      [86, "India"], [83, "Indonesia"], [96, "Italy"], [136, "Netherlands"],
      [143, "Philippines"], [149, "Russia"], [159, "Thailand"], [161, "Turkey"],
      [31, "Canada"], [8, "Australia"], [120, "Mexico"], [38, "China"],
      [154, "Spain"], [144, "Poland"], [100, "Jordan"], [202, "Palestine"],
    ];
    const dlg = new DialogBuilder("proxy_flag")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83C\uDFF3 Flag Picker``", 3002)
      .addSmallText("Change your country flag (client-side only)");

    for (const [id, name] of flags) {
      dlg.addButton(`f_${id}`, `\`w${name}\`\` (${id})`);
    }

    dlg.addSpacer(true)
      .addSmallText("`wCustom Flag ID:``")
      .addTextInput("custom_flag", "Flag ID:", "", 5)
      .addButton("f_custom", "`w\u2714 Apply Custom``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back to Visual``")
      .endDialog("f_custom", "", "Close");

    this.showDialog(clientId, dlg.build());
  }

  _showZoomPicker(clientId) {
    const dlg = new DialogBuilder("proxy_zoom")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83D\uDD0D Zoom Picker``", 5814)
      .addSmallText("Set camera zoom level (1 = closest, 10 = farthest)");

    for (let i = 1; i <= 10; i++) {
      const label = i === 5 ? `\`2${i} (Default)\`\`` : `\`w${i}\`\``;
      dlg.addButton(`z_${i}`, label);
    }

    dlg.addSpacer(true)
      .addButton("back", "`o\u25C0 Back to Visual``")
      .endDialog("close", "", "Close");

    this.showDialog(clientId, dlg.build());
  }

  _showOutfitEditor(clientId) {
    const slots = [
      ["hat", "Hat"], ["shirt", "Shirt"], ["pants", "Pants"],
      ["shoes", "Shoes"], ["face", "Face Item"], ["hand", "Hand"],
      ["back_item", "Back"], ["hair", "Hair"], ["neck", "Necklace"],
    ];
    const dlg = new DialogBuilder("proxy_outfit")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83D\uDC55 Outfit Editor``", 4994)
      .addSmallText("Enter item IDs for each slot (0 = empty, client-side only)")
      .addSpacer(true);

    for (const [id, label] of slots) {
      dlg.addTextInput(id, `${label}:`, "0", 6);
    }

    dlg.addSpacer(true)
      .addButton("do_apply", "`2\u2714 Apply Outfit``")
      .addButton("do_clear", "`4\u2716 Clear All``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back to Visual``")
      .endDialog("do_apply", "", "Close");

    this.showDialog(clientId, dlg.build());
  }

  _showDropPicker(clientId) {
    const dlg = new DialogBuilder("proxy_drop")
      .setDefaultColor("`o")
      .addLabelBig("`w\u2B07 Drop Picker``", 242)
      .addSmallText("Choose lock type and amount to drop")
      .addSpacer(true)
      .addTextInput("drop_amount", "Amount (max 200):", "1", 5)
      .addSpacer(true)
      .addButtonWithIcon("do_drop_wl", "\`w\u2B07 Drop World Locks\`\`", 242, "staticBlueFrame")
      .addButtonWithIcon("do_drop_dl", "\`w\u2B07 Drop Diamond Locks\`\`", 1796, "staticBlueFrame")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back to Economy``")
      .endDialog("close", "", "Close");

    this.showDialog(clientId, dlg.build());
  }

  _showLockPicker(clientId) {
    const dlg = new DialogBuilder("proxy_lock")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83D\uDD12 Lock Placer``", 202)
      .addSmallText("Place a lock at your feet (requires world admin)")
      .addSpacer(true)
      .addButtonWithIcon("l_sl", "\`wSmall Lock\`\`", 202, "staticBlueFrame")
      .addButtonWithIcon("l_bl", "\`wBig Lock\`\`", 204, "staticBlueFrame")
      .addButtonWithIcon("l_wl", "\`wWorld Lock\`\`", 242, "staticBlueFrame")
      .addButtonWithIcon("l_dl", "\`wDiamond Lock\`\`", 1796, "staticBlueFrame")
      .addButtonWithIcon("l_bgl", "\`wBlue Gem Lock\`\`", 7188, "staticBlueFrame")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back to Economy``")
      .endDialog("close", "", "Close");

    this.showDialog(clientId, dlg.build());
  }

  _showEquipPicker(clientId) {
    const gel = this.proxy.gameEventLogger;
    const dlg = new DialogBuilder("proxy_equip")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83D\uDC55 Equip / Unequip``", 4994)
      .addSmallText("Wear or remove items by ID");

    if (gel.inventory.size > 0) {
      dlg.addSpacer(true).addSmallText("`wInventory (top 20):``");
      let count = 0;
      for (const [itemId, qty] of gel.inventory) {
        if (count >= 20) break;
        dlg.addButtonWithIcon(`eq_${itemId}`, `\`wEquip\`\` ID:${itemId} (x${qty})`, itemId, "staticBlueFrame");
        count++;
      }
    }

    dlg.addSpacer(true)
      .addSmallText("`wManual:``")
      .addTextInput("equip_id", "Item ID:", "", 6)
      .addButton("do_equip", "`2\u2714 Equip``")
      .addButton("do_unequip", "`4\u2716 Unequip``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back to Economy``")
      .endDialog("do_equip", "", "Close");

    this.showDialog(clientId, dlg.build());
  }

  _showTrashPicker(clientId) {
    const dlg = new DialogBuilder("proxy_trash_dlg")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83D\uDDD1 Trash Item``", 5638)
      .addSmallText("Delete items from your inventory")
      .addSpacer(true)
      .addTextInput("trash_id", "Item ID:", "", 6)
      .addTextInput("trash_amount", "Amount (max 200):", "1", 5)
      .addSpacer(true)
      .addButton("do_trash", "`4\uD83D\uDDD1 Trash``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back to Economy``")
      .endDialog("do_trash", "", "Close");

    this.showDialog(clientId, dlg.build());
  }

  _showBuyPicker(clientId) {
    const dlg = new DialogBuilder("proxy_buy_dlg")
      .setDefaultColor("`o")
      .addLabelBig("`w\uD83D\uDED2 Buy Item``", 1424)
      .addSmallText("Buy items from the store")
      .addSpacer(true)
      .addTextInput("buy_id", "Item ID:", "", 6)
      .addTextInput("buy_amount", "Amount (max 200):", "1", 5)
      .addSpacer(true)
      .addButton("do_buy", "`2\uD83D\uDED2 Buy``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back to Economy``")
      .endDialog("do_buy", "", "Close");

    this.showDialog(clientId, dlg.build());
  }

  _showFastvendPicker(clientId) {
    const dlg = new DialogBuilder("proxy_fastvend_dlg")
      .setDefaultColor("`o")
      .addLabelBig("`w\u26A1 Fast Vend``", 3832)
      .addSmallText("Quick bulk buy or sell")
      .addSpacer(true)
      .addTextInput("vend_id", "Item ID:", "", 6)
      .addTextInput("vend_qty", "Quantity (max 200):", "1", 5)
      .addSpacer(true)
      .addButton("do_vbuy", "`2\uD83D\uDED2 Buy``")
      .addButton("do_vsell", "`4\uD83D\uDCB0 Sell``")
      .addSpacer(true)
      .addButton("back", "`o\u25C0 Back to Economy``")
      .endDialog("close", "", "Close");

    this.showDialog(clientId, dlg.build());
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
      case "back":            this.showMainMenu(clientId); break;
      case "do_balance":      this._execCmd(clientId, "balance"); break;
      case "do_backpack":     this._execCmd(clientId, "backpack"); break;
      case "do_upgrade":      this._execCmd(clientId, "upgrade"); break;
      case "do_daw":          this._execCmd(clientId, "daw"); break;
      case "open_drop":       this._showDropPicker(clientId); break;
      case "open_lock":       this._showLockPicker(clientId); break;
      case "open_equip":      this._showEquipPicker(clientId); break;
      case "open_buy":        this._showBuyPicker(clientId); break;
      case "open_trash":      this._showTrashPicker(clientId); break;
      case "open_fastvend":   this._showFastvendPicker(clientId); break;
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
      case "back":           this.showMainMenu(clientId); break;
      case "do_mod":         this._execCmd(clientId, "mod"); break;
      case "do_dev":         this._execCmd(clientId, "dev"); break;
      case "do_invis":       this._execCmd(clientId, "invis"); break;
      case "do_fakeban":     this._execCmd(clientId, "fakeban"); break;
      case "open_weather":   this._showWeatherPicker(clientId); break;
      case "open_zoom":      this._showZoomPicker(clientId); break;
      case "open_skin":      this._showSkinPicker(clientId); break;
      case "open_flag":      this._showFlagPicker(clientId); break;
      case "open_outfit":    this._showOutfitEditor(clientId); break;
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

  // ── Picker Response Handlers ────────────────────────────────────────

  _onWeatherPicker(clientId, btn, pairs) {
    if (btn === "back") { this._showVisualPanel(clientId); return true; }
    if (btn === "w_custom") {
      const id = (pairs.custom_id || "").trim();
      if (id !== "") this._execCmd(clientId, `weather ${id}`);
      else this._sendChat(clientId, "`4[Proxy]`` Enter a weather ID");
      return true;
    }
    if (btn.startsWith("w_")) {
      const id = btn.substring(2);
      this._execCmd(clientId, `weather ${id}`);
    }
    return true;
  }

  _onSkinPicker(clientId, btn, pairs) {
    if (btn === "back") { this._showVisualPanel(clientId); return true; }
    if (btn === "s_custom") {
      const id = (pairs.custom_skin || "").trim();
      if (id !== "") this._execCmd(clientId, `skin ${id}`);
      else this._sendChat(clientId, "`4[Proxy]`` Enter a color ID");
      return true;
    }
    if (btn.startsWith("s_")) {
      const id = btn.substring(2);
      this._execCmd(clientId, `skin ${id}`);
    }
    return true;
  }

  _onFlagPicker(clientId, btn, pairs) {
    if (btn === "back") { this._showVisualPanel(clientId); return true; }
    if (btn === "f_custom") {
      const id = (pairs.custom_flag || "").trim();
      if (id !== "") this._execCmd(clientId, `flag ${id}`);
      else this._sendChat(clientId, "`4[Proxy]`` Enter a flag ID");
      return true;
    }
    if (btn.startsWith("f_")) {
      const id = btn.substring(2);
      this._execCmd(clientId, `flag ${id}`);
    }
    return true;
  }

  _onZoomPicker(clientId, btn) {
    if (btn === "back") { this._showVisualPanel(clientId); return true; }
    if (btn.startsWith("z_")) {
      const level = btn.substring(2);
      this._execCmd(clientId, `zoom ${level}`);
    }
    return true;
  }

  _onOutfitEditor(clientId, btn, pairs) {
    if (btn === "back") { this._showVisualPanel(clientId); return true; }
    if (btn === "do_clear") {
      this._execCmd(clientId, "clothes 0 0 0 0 0 0 0 0 0");
      return true;
    }
    if (btn === "do_apply") {
      const hat   = (pairs.hat || "0").trim();
      const shirt = (pairs.shirt || "0").trim();
      const pants = (pairs.pants || "0").trim();
      const shoes = (pairs.shoes || "0").trim();
      const face  = (pairs.face || "0").trim();
      const hand  = (pairs.hand || "0").trim();
      const back  = (pairs.back_item || "0").trim();
      const hair  = (pairs.hair || "0").trim();
      const neck  = (pairs.neck || "0").trim();
      this._execCmd(clientId, `clothes ${hat} ${shirt} ${pants} ${shoes} ${face} ${hand} ${back} ${hair} ${neck}`);
    }
    return true;
  }

  _onDropPicker(clientId, btn, pairs) {
    if (btn === "back") { this._showEconomyPanel(clientId); return true; }
    const amount = (pairs.drop_amount || "1").trim();
    if (btn === "do_drop_wl") {
      this._execCmd(clientId, `cdrop wl ${amount}`);
    } else if (btn === "do_drop_dl") {
      this._execCmd(clientId, `cdrop dl ${amount}`);
    }
    return true;
  }

  _onLockPicker(clientId, btn) {
    if (btn === "back") { this._showEconomyPanel(clientId); return true; }
    const lockMap = { l_sl: "sl", l_bl: "bl", l_wl: "wl", l_dl: "dl", l_bgl: "bgl" };
    if (lockMap[btn]) {
      this._execCmd(clientId, `lock ${lockMap[btn]}`);
    }
    return true;
  }

  _onEquipPicker(clientId, btn, pairs) {
    if (btn === "back") { this._showEconomyPanel(clientId); return true; }
    if (btn === "do_equip") {
      const id = (pairs.equip_id || "").trim();
      if (id) this._execCmd(clientId, `equip ${id}`);
      else this._sendChat(clientId, "`4[Proxy]`` Enter an item ID");
      return true;
    }
    if (btn === "do_unequip") {
      const id = (pairs.equip_id || "").trim();
      if (id) this._execCmd(clientId, `unequip ${id}`);
      else this._sendChat(clientId, "`4[Proxy]`` Enter an item ID");
      return true;
    }
    if (btn.startsWith("eq_")) {
      const id = btn.substring(3);
      this._execCmd(clientId, `equip ${id}`);
    }
    return true;
  }

  _onTrashPicker(clientId, btn, pairs) {
    if (btn === "back") { this._showEconomyPanel(clientId); return true; }
    if (btn === "do_trash") {
      const id = (pairs.trash_id || "").trim();
      const amount = (pairs.trash_amount || "1").trim();
      if (id) this._execCmd(clientId, `trash ${id} ${amount}`);
      else this._sendChat(clientId, "`4[Proxy]`` Enter an item ID");
    }
    return true;
  }

  _onBuyPicker(clientId, btn, pairs) {
    if (btn === "back") { this._showEconomyPanel(clientId); return true; }
    if (btn === "do_buy") {
      const id = (pairs.buy_id || "").trim();
      const amount = (pairs.buy_amount || "1").trim();
      if (id) this._execCmd(clientId, `buy ${id} ${amount}`);
      else this._sendChat(clientId, "`4[Proxy]`` Enter an item ID");
    }
    return true;
  }

  _onFastvendPicker(clientId, btn, pairs) {
    if (btn === "back") { this._showEconomyPanel(clientId); return true; }
    const id = (pairs.vend_id || "").trim();
    const qty = (pairs.vend_qty || "1").trim();
    if (!id) { this._sendChat(clientId, "`4[Proxy]`` Enter an item ID"); return true; }
    if (btn === "do_vbuy") {
      this._execCmd(clientId, `fastvend buy ${id} ${qty}`);
    } else if (btn === "do_vsell") {
      this._execCmd(clientId, `fastvend sell ${id} ${qty}`);
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
