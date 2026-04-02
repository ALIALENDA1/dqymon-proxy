const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Game log writer — writes proxy connection status to a log file
 * that the user can review to see success/failure rates.
 */
class GameLog {
  constructor() {
    // Determine log file path — next to the exe, or in GT's appdata
    this.logPath = this.findLogPath();
    this.stats = {
      loginAttempts: 0,
      loginSuccess: 0,
      loginFail: 0,
      connections: 0,
      connectionSuccess: 0,
      connectionFail: 0,
      totalClientPackets: 0,
      totalServerPackets: 0,
      startTime: Date.now(),
    };

    // Write header on startup
    this.clear();
    this.write("═══════════════════════════════════════════");
    this.write("  dqymon-proxy — Game Connection Log");
    this.write("═══════════════════════════════════════════");
    this.write(`Started: ${new Date().toLocaleString()}`);
    this.write("");
  }

  findLogPath() {
    // Try current directory first (next to exe)
    const cwd = process.cwd();
    try {
      fs.accessSync(cwd, fs.constants.W_OK);
      return path.join(cwd, "proxy_game.log");
    } catch {
      // Fallback to temp
      return path.join(os.tmpdir(), "proxy_game.log");
    }
  }

  clear() {
    try { fs.writeFileSync(this.logPath, ""); } catch {}
  }

  write(msg) {
    const ts = new Date().toLocaleTimeString();
    const line = `[${ts}] ${msg}\n`;
    try {
      fs.appendFileSync(this.logPath, line);
    } catch {}
  }

  logLogin(success, details) {
    this.stats.loginAttempts++;
    if (success) {
      this.stats.loginSuccess++;
      this.write(`✓ LOGIN OK — ${details}`);
    } else {
      this.stats.loginFail++;
      this.write(`✗ LOGIN FAIL — ${details}`);
    }
    this.writeStats();
  }

  logConnection(sessionId, target) {
    this.stats.connections++;
    this.write(`→ CONNECTION #${this.stats.connections}: ${sessionId} → ${target}`);
  }

  logConnectionSuccess(sessionId, target) {
    this.stats.connectionSuccess++;
    this.write(`✓ CONNECTED: ${sessionId} → ${target} (server responded!)`);
    this.writeStats();
  }

  logConnectionFail(sessionId, target, reason) {
    this.stats.connectionFail++;
    this.write(`✗ CONNECT FAIL: ${sessionId} → ${target} — ${reason}`);
    this.writeStats();
  }

  logPackets(clientCount, serverCount) {
    this.stats.totalClientPackets += clientCount;
    this.stats.totalServerPackets += serverCount;
  }

  logPacketSent() {
    this.stats.totalClientPackets++;
  }

  logPacketReceived() {
    this.stats.totalServerPackets++;
  }

  logMaintenance(msg) {
    this.write(`⚠ MAINTENANCE: ${msg}`);
  }

  logEvent(msg) {
    this.write(msg);
  }

  writeStats() {
    const s = this.stats;
    const uptime = Math.floor((Date.now() - s.startTime) / 1000);
    const loginRate = s.loginAttempts > 0
      ? Math.round((s.loginSuccess / s.loginAttempts) * 100)
      : 0;
    const connRate = s.connections > 0
      ? Math.round((s.connectionSuccess / s.connections) * 100)
      : 0;

    this.write("── Stats ──────────────────────────────────");
    this.write(`  Uptime: ${uptime}s`);
    this.write(`  Login:  ${s.loginSuccess}/${s.loginAttempts} (${loginRate}% success)`);
    this.write(`  Connect: ${s.connectionSuccess}/${s.connections} (${connRate}% success)`);
    this.write(`  Packets: ${s.totalClientPackets} sent, ${s.totalServerPackets} received`);
    this.write("───────────────────────────────────────────");
  }
}

module.exports = GameLog;
