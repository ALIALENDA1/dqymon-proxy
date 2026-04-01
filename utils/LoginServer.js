const https = require("https");
const http = require("http");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("../config/config");
const Logger = require("./Logger");

class LoginServer {
  constructor() {
    this.logger = new Logger();
    this.server = null;
    this.certDir = path.join(__dirname, "..", "certs");
  }

  /**
   * Generate a self-signed certificate for Growtopia domains.
   * Requires openssl in PATH. Returns null if unavailable.
   */
  generateCert() {
    if (!fs.existsSync(this.certDir)) {
      fs.mkdirSync(this.certDir, { recursive: true });
    }

    const keyPath = path.join(this.certDir, "key.pem");
    const certPath = path.join(this.certDir, "cert.pem");

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    }

    try {
      const subj = "/CN=www.growtopia1.com";
      const san = "subjectAltName=DNS:www.growtopia1.com,DNS:www.growtopia2.com";
      execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
          `-days 365 -nodes -subj "${subj}" -addext "${san}" 2>/dev/null`,
        { stdio: "pipe" }
      );
      this.logger.info("✓ Generated self-signed certificate");
      return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    } catch {
      this.logger.warn(
        "openssl not found — falling back to HTTP only. " +
          "If Growtopia requires HTTPS, install openssl and restart."
      );
      return null;
    }
  }

  /**
   * Build the server_data.php response that tells Growtopia
   * to connect to the proxy instead of the real server.
   */
  getServerData() {
    const proxyHost =
      config.proxy.host === "0.0.0.0" ? "127.0.0.1" : config.proxy.host;

    return [
      `server|${proxyHost}`,
      `port|${config.proxy.port}`,
      `type|1`,
      `#maint|`,
      `meta|defined`,
      `RTENDMARKERBS1001`,
    ].join("\n");
  }

  handleRequest(req, res) {
    this.logger.info(`[LOGIN] ${req.method} ${req.url}`);
    const data = this.getServerData();
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Content-Length": Buffer.byteLength(data),
    });
    res.end(data);
  }

  start() {
    const handler = (req, res) => this.handleRequest(req, res);
    const certs = this.generateCert();

    if (certs) {
      this.server = https.createServer(
        { key: certs.key, cert: certs.cert },
        handler
      );

      this.server.listen(443, () => {
        this.logger.info("✓ Login server started on HTTPS :443");
      });

      this.server.on("error", (err) => {
        if (err.code === "EACCES" || err.code === "EADDRINUSE") {
          this.logger.warn(
            `HTTPS :443 failed (${err.code}). Trying HTTP :80...`
          );
          this.startHttp(handler);
        } else {
          this.logger.error(`Login server error: ${err.message}`);
        }
      });
    } else {
      this.startHttp(handler);
    }
  }

  startHttp(handler) {
    this.server = http.createServer(handler);

    this.server.listen(80, () => {
      this.logger.info("✓ Login server started on HTTP :80");
    });

    this.server.on("error", (err) => {
      this.logger.error(
        `Login server on :80 failed (${err.code}). ` +
          "Run as Administrator / root to bind to privileged ports."
      );
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

module.exports = LoginServer;
