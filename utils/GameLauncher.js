const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const config = require("../config/config");
const Logger = require("./Logger");

const HOSTS_FILE =
  process.platform === "win32"
    ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
    : "/etc/hosts";

const GT_DOMAINS = [
  "www.growtopia1.com",
  "www.growtopia2.com",
  "login.growtopiagame.com",
  "growtopia1.com",
  "growtopia2.com",
];
const GT_MARKER = "# dqymon-proxy";

class GameLauncher {
  constructor() {
    this.logger = new Logger();
    this.gameProcess = null;
    this.hostsModified = false;
  }

  /**
   * Search common install locations for Growtopia.exe.
   * Returns the first path found, or null.
   */
  findGrowtopia() {
    // User-configured path takes priority
    if (config.game && config.game.path) {
      if (fs.existsSync(config.game.path)) return config.game.path;
      this.logger.warn(`Configured game path not found: ${config.game.path}`);
    }

    const candidates = [];

    if (process.platform === "win32") {
      const local = process.env.LOCALAPPDATA || "";
      candidates.push(
        path.join(local, "Growtopia", "Growtopia.exe"),
        "C:\\Program Files\\Growtopia\\Growtopia.exe",
        "C:\\Program Files (x86)\\Growtopia\\Growtopia.exe",
        path.join(os.homedir(), "Growtopia", "Growtopia.exe")
      );
    } else if (process.platform === "darwin") {
      candidates.push("/Applications/Growtopia.app/Contents/MacOS/Growtopia");
    } else {
      candidates.push("/usr/bin/growtopia", "/usr/local/bin/growtopia");
    }

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }

    return null;
  }

  // ── Hosts file management ────────────────────────────────────────────

  /**
   * Add 127.0.0.1 entries for Growtopia domains so the game's
   * login request hits our local LoginServer instead of Ubisoft.
   */
  modifyHosts() {
    try {
      let hosts = fs.readFileSync(HOSTS_FILE, "utf8");

      // Strip old proxy lines (idempotent)
      hosts = hosts
        .split("\n")
        .filter((l) => !l.includes(GT_MARKER))
        .join("\n");

      const entries = GT_DOMAINS.map(
        (d) => `127.0.0.1 ${d} ${GT_MARKER}`
      ).join("\n");

      hosts = hosts.trimEnd() + "\n" + entries + "\n";
      fs.writeFileSync(HOSTS_FILE, hosts);
      this.hostsModified = true;
      this.logger.info("✓ Hosts file updated — redirecting:");
      GT_DOMAINS.forEach((d) => this.logger.info(`    ${d} → 127.0.0.1`));
      return true;
    } catch (err) {
      if (err.code === "EACCES" || err.code === "EPERM") {
        this.logger.error(
          "✗ Cannot modify hosts file — YOU MUST RUN AS ADMINISTRATOR!"
        );
      } else {
        this.logger.error(`✗ Hosts file error: ${err.message}`);
      }
      return false;
    }
  }

  /**
   * Read hosts file back and confirm our entries are present.
   */
  verifyHosts() {
    try {
      const hosts = fs.readFileSync(HOSTS_FILE, "utf8");
      const lines = hosts.split("\n").filter((l) => l.includes(GT_MARKER));
      if (lines.length >= GT_DOMAINS.length) {
        this.logger.info(`✓ Hosts file verified (${lines.length} entries)`);
      } else {
        this.logger.warn(
          `✗ Hosts file only has ${lines.length}/${GT_DOMAINS.length} entries`
        );
      }
    } catch (err) {
      this.logger.warn(`✗ Could not verify hosts: ${err.message}`);
    }
  }

  /**
   * Flush the Windows DNS resolver cache so hosts file changes take effect.
   */
  flushDns() {
    if (process.platform !== "win32") return;
    try {
      execSync("ipconfig /flushdns", { stdio: "pipe" });
      this.logger.info("✓ DNS cache flushed");
    } catch {
      this.logger.warn("Could not flush DNS cache");
    }
  }

  /**
   * Add Windows Firewall rules to allow traffic on ports 80, 443, 8080.
   * Silently fails on non-Windows or if already exists.
   */
  addFirewallRules() {
    if (process.platform !== "win32") return;
    // TCP rules for HTTP/HTTPS login server ports
    for (const port of [80, 443, 8080]) {
      try {
        execSync(
          `netsh advfirewall firewall add rule name="dqymon-proxy-tcp-${port}" ` +
          `dir=in action=allow protocol=TCP localport=${port} >nul 2>&1`,
          { stdio: "pipe" }
        );
      } catch {
        // Rule may already exist — that's fine
      }
    }
    // UDP rule for ENet proxy port (ENet uses UDP, not TCP)
    try {
      execSync(
        `netsh advfirewall firewall add rule name="dqymon-proxy-udp-17091" ` +
        `dir=in action=allow protocol=UDP localport=${config.proxy.port} >nul 2>&1`,
        { stdio: "pipe" }
      );
    } catch {
      // Rule may already exist
    }
    this.logger.info(`✓ Firewall rules added (TCP: 80,443,8080 | UDP: ${config.proxy.port})`);
  }

  /**
   * Remove the proxy entries we added, restoring original resolution.
   */
  restoreHosts() {
    if (!this.hostsModified) return;

    try {
      let hosts = fs.readFileSync(HOSTS_FILE, "utf8");
      hosts = hosts
        .split("\n")
        .filter((l) => !l.includes(GT_MARKER))
        .join("\n");
      fs.writeFileSync(HOSTS_FILE, hosts);
      this.hostsModified = false;
      this.logger.info("✓ Hosts file restored");
    } catch (err) {
      this.logger.error(`Failed to restore hosts file: ${err.message}`);
    }
  }

  // ── Game launch ──────────────────────────────────────────────────────

  /**
   * Find and launch Growtopia. Returns true on success.
   */
  launch() {
    const gamePath = this.findGrowtopia();

    if (!gamePath) {
      this.logger.error(
        "Growtopia not found. Set game.path in config/config.js"
      );
      return false;
    }

    this.logger.info(`Launching: ${gamePath}`);

    this.gameProcess = spawn(gamePath, [], {
      detached: true,
      stdio: "ignore",
      cwd: path.dirname(gamePath),
    });

    this.gameProcess.on("error", (err) => {
      this.logger.error(`Failed to launch Growtopia: ${err.message}`);
    });

    this.gameProcess.on("exit", (code) => {
      this.logger.info(`Growtopia exited (code ${code})`);
      this.gameProcess = null;
    });

    this.gameProcess.unref();
    this.logger.info("✓ Growtopia launched");
    return true;
  }

  /**
   * Check whether the game process is still alive.
   */
  isRunning() {
    if (!this.gameProcess) return false;
    try {
      process.kill(this.gameProcess.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Called on proxy shutdown — restore the hosts file.
   */
  cleanup() {
    this.restoreHosts();
  }
}

module.exports = GameLauncher;
