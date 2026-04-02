const config = require("../config/config");

// ── ANSI color codes ─────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  // Foreground
  black:   "\x1b[30m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  cyan:    "\x1b[36m",
  white:   "\x1b[37m",
  gray:    "\x1b[90m",
  // Bright
  bRed:    "\x1b[91m",
  bGreen:  "\x1b[92m",
  bYellow: "\x1b[93m",
  bBlue:   "\x1b[94m",
  bMagenta:"\x1b[95m",
  bCyan:   "\x1b[96m",
  bWhite:  "\x1b[97m",
  // Background
  bgRed:   "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow:"\x1b[43m",
  bgBlue:  "\x1b[44m",
  bgMagenta:"\x1b[45m",
  bgCyan:  "\x1b[46m",
};

// ── Game event tag colors ────────────────────────────────────────
const TAG_COLORS = {
  DROP:     `${C.bgRed}${C.bold}${C.white}`,
  PICKUP:   `${C.bgGreen}${C.bold}${C.black}`,
  CHAT:     `${C.bCyan}`,
  BUBBLE:   `${C.bCyan}`,
  SAY:      `${C.bCyan}${C.bold}`,
  MSG:      `${C.white}`,
  WORLD:    `${C.bBlue}`,
  JOIN:     `${C.bBlue}${C.bold}`,
  EXIT:     `${C.blue}`,
  SPAWN:    `${C.bGreen}${C.bold}`,
  PLAYER:   `${C.green}`,
  LEAVE:    `${C.gray}`,
  TRADE:    `${C.bYellow}${C.bold}`,
  GEMS:     `${C.bYellow}`,
  AUTH:     `${C.bMagenta}${C.bold}`,
  LOGIN:    `${C.bMagenta}`,
  STATUS:   `${C.yellow}`,
  NOTIFY:   `${C.yellow}`,
  DIALOG:   `${C.magenta}`,
  OVERLAY:  `${C.magenta}`,
  BROADCAST:`${C.bgMagenta}${C.bold}${C.white}`,
  MENU:     `${C.blue}`,
  QUIT:     `${C.red}`,
  TRASH:    `${C.red}`,
  TILE:     `${C.dim}`,
};

class Logger {
  constructor() {
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };

    this.currentLevel = this.levels[config.logging.level] || this.levels.info;
  }

  /**
   * Format a timestamp as HH:MM:SS
   */
  static ts() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  }

  debug(message) {
    if (this.levels.debug >= this.currentLevel) {
      console.log(`${C.gray}${Logger.ts()} ${C.dim}DBG${C.reset} ${C.gray}${message}${C.reset}`);
    }
  }

  info(message) {
    if (this.levels.info >= this.currentLevel) {
      console.log(`${C.gray}${Logger.ts()} ${C.bCyan}INF${C.reset} ${message}`);
    }
  }

  warn(message) {
    if (this.levels.warn >= this.currentLevel) {
      console.warn(`${C.gray}${Logger.ts()} ${C.bYellow}WRN${C.reset} ${C.yellow}${message}${C.reset}`);
    }
  }

  error(message) {
    if (this.levels.error >= this.currentLevel) {
      console.error(`${C.gray}${Logger.ts()} ${C.bRed}ERR${C.reset} ${C.red}${message}${C.reset}`);
    }
  }

  /**
   * Game event log — colorized by tag for quick scanning.
   * Parses [TAG] prefix from message and applies matching color.
   */
  game(message) {
    const tagMatch = message.match(/^\[(\w+)\]\s*(.*)/);
    if (tagMatch) {
      const tag = tagMatch[1];
      const rest = tagMatch[2];
      const tagColor = TAG_COLORS[tag] || C.white;
      console.log(
        `${C.gray}${Logger.ts()} ${tagColor} ${tag.padEnd(9)} ${C.reset} ${rest}`
      );
    } else {
      console.log(`${C.gray}${Logger.ts()} ${C.bCyan} GAME      ${C.reset} ${message}`);
    }
  }

  /**
   * Print a styled banner/box.
   */
  static banner(lines) {
    const maxLen = Math.max(...lines.map(l => l.length));
    const border = "═".repeat(maxLen + 2);
    console.log(`${C.bCyan}╔${border}╗${C.reset}`);
    for (const line of lines) {
      console.log(`${C.bCyan}║${C.reset} ${C.bold}${C.bWhite}${line.padEnd(maxLen)}${C.reset} ${C.bCyan}║${C.reset}`);
    }
    console.log(`${C.bCyan}╚${border}╝${C.reset}`);
  }

  /**
   * Print a section header separator.
   */
  static section(title) {
    console.log(`\n${C.gray}── ${C.bWhite}${title} ${C.gray}${"─".repeat(Math.max(0, 50 - title.length))}${C.reset}`);
  }
}

Logger.C = C;

module.exports = Logger;
