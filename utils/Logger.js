const config = require("../../config/config");

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

  debug(message) {
    if (this.levels.debug >= this.currentLevel) {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`);
    }
  }

  info(message) {
    if (this.levels.info >= this.currentLevel) {
      console.log(`[INFO] ${new Date().toISOString()} - ${message}`);
    }
  }

  warn(message) {
    if (this.levels.warn >= this.currentLevel) {
      console.warn(`[WARN] ${new Date().toISOString()} - ${message}`);
    }
  }

  error(message) {
    if (this.levels.error >= this.currentLevel) {
      console.error(`[ERROR] ${new Date().toISOString()} - ${message}`);
    }
  }
}

module.exports = Logger;
