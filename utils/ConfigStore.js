const fs = require("fs");
const path = require("path");
const Logger = require("./Logger");

/**
 * Persistent JSON config store for proxy state.
 * Saves/loads from config.json next to the executable.
 */
class ConfigStore {
  constructor() {
    this.logger = new Logger();
    this.filePath = path.join(process.cwd(), "config.json");
    this.data = this.getDefaults();
    this.load();
  }

  getDefaults() {
    return {
      // Saved accounts for /switch
      accounts: [],
      // Active account index
      activeAccount: -1,
      // Custom MAC (null = random)
      mac: null,
      // Saved worlds for /save / /back
      savedWorlds: [],
      // Last used command for /re
      lastCommand: null,
      // UI prefs
      ui: {
        color: "cyan",
        showBroadcasts: true,
        showTradeMessages: true,
      },
      // Spoofing prefs
      spoof: {
        mac: "random",
        rid: "random",
        hash: "random",
        hash2: "random",
        fhash: "random",
        zf: "random",
      },
      // Client visual settings
      visuals: {
        customSkin: null,
        customFlag: null,
        customName: null,
      },
    };
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw);
        // Merge with defaults so new keys are always present
        this.data = { ...this.getDefaults(), ...parsed };
        this.logger.info(`✓ Config loaded from ${this.filePath}`);
      }
    } catch (e) {
      this.logger.warn(`Config load failed: ${e.message} — using defaults`);
      this.data = this.getDefaults();
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
      return true;
    } catch (e) {
      this.logger.error(`Config save failed: ${e.message}`);
      return false;
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
  }
}

module.exports = ConfigStore;
