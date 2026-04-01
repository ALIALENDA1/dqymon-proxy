const https = require("https");
const http = require("http");
const net = require("net");
const config = require("../config/config");
const Logger = require("./Logger");

// Embedded self-signed certificate for Growtopia domains
// Valid for 10 years — no openssl dependency needed.
const EMBEDDED_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCTfIGaXcakRgI8
Rcgu41QrupDiM7URGlX2Qmpc4UQ/B3T5hkcQw4Hfvn3Ck0S0KJ/6YRbHGjQVQ02Y
fPJrQoirvOKAcrvCkAFZGRRMQFUJxuwcJ5SBX552/pJmYlKQ9RueQORt6Nbm0fST
FW5MALC2+qLunKBXRoeWFGRFPBUiuiqk5qJYlswFtrCaSRQOx8HbbFe0FhbzX2I8
6BtMRm2dxoVnaUAG6FViUcPkSBD6Yz+Pis+FuGhXQ3HNTzDT3Oi5qI4ohLLwVA48
iJ/+NhGfDeu/TRJXQGHOjvuB9U7lkSEVnJQPa59it/S9DPUv4JLIjeO06TYn3yNZ
uBYRt64BAgMBAAECggEACCLsxXbZ8BMaqXeSESAicx0iRBBlM1HYHzNPydr1mGKR
bfid8AtRHWZVasgUGLpLBRWZG5fS+r9RRxHRj+BGSO8tMbfiqtul72PmTkSYTGdI
fE8krrR3OgpWSkavVmbnRKZA091uCaLYksqyYIgDN70BAxfp8pamAT4TwAwOAHHe
VIa45PwJwZ4ejF7+pqmUmlo670gfUrduJAIeHoH9O95E+k1YhVBhaYDflqf927DI
WhQz8gGmCDKkFNqzvsLHEonW0S0FEGnTjULeMZaWs0asEQwekZMevGHRPDWOn7L4
PTh9ooeVGga7mJDdbLFl5rQ1EVXoy7GGI8c3w9CwIQKBgQDL5P7+t/MT7XsZeLSd
e1QLF5g1oVtyBlGHHsU7fGVKNzVnu1rhk6/Z+S0j1Ca7eQb9s/3EJBPkPjD+nLAk
17FzjCCiiRBReEEWSKaseDroTZ7noaIx96vYP6jctfq+IXRCEt0Kl4ZY8dcmU3W3
yKq28o68Zk3bH/WAq279eBJxaQKBgQC5LTnZ0Kaj+YL8mOKqyNLSxgkTalkHyG3q
Kxxi77L9q8ecupV61QLUkGKJ7xfqbvDXVuQ9modgYxZ3VRoQzW+e3EBqk9GLdj2q
zZUGAcQNv6cSA4bc/w7VSQt2WMqtSGha329b8EA3bBxGX1yvCwiAK4Xg7DATJ8C4
pQ4up2us2QKBgGJGSbG0L/FW8ZJhX4zYOLXv9WlEELNw4DLkXeRCHQAchB0vbKp1
aLkDJQKz6sdJmlkGPDYhvYSxhSPzmeLoI5ux2rj8n2TlNVnsQom2mY4Ge6Thfy/e
VHGynU1kWSrzLPn75ZaJWjPcvPq4F3ExwzbSyoF8PeJ0EPynpKN/EEShAoGBAKyO
z30BKXheF8jpczfw4jzVnDmCfap6BKsVN2OeuK4YuG99k7Qd8YBBeAHPUvr8HOSe
LRyW9pZEX/gdzqdfuSdRWZm3W6pZKggTgU5SsO6a7MYlkTQ5Xgo1AkBrZ5rogY5E
7hG/pSfAT+zoCod3gZlmdWBu2DHRdo7aCIhDLVypAoGBAIyFtUTY7/ncDV/+2wiC
Qpw/LdErxry2mMCsX7abwzGcjaC8ssHMAXnUISY8eu219AOBvAFxLBp0zsoNdMVU
WTu1eIXFfZSGeqpMlLugLutxQlex7OXlPZxjhAiNKDwwmm94opmWBPbjUtoBJACV
jBWruiYdnHHnCiWQu/yt3tD4
-----END PRIVATE KEY-----`;

const EMBEDDED_CERT = `-----BEGIN CERTIFICATE-----
MIIDUDCCAjigAwIBAgIUXAPOehOkv9/5gm3SCmOs+xn3ppIwDQYJKoZIhvcNAQEL
BQAwHTEbMBkGA1UEAwwSd3d3Lmdyb3d0b3BpYTEuY29tMB4XDTI2MDQwMTA4Mzgz
MFoXDTM2MDMyOTA4MzgzMFowHTEbMBkGA1UEAwwSd3d3Lmdyb3d0b3BpYTEuY29t
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAk3yBml3GpEYCPEXILuNU
K7qQ4jO1ERpV9kJqXOFEPwd0+YZHEMOB3759wpNEtCif+mEWxxo0FUNNmHzya0KI
q7zigHK7wpABWRkUTEBVCcbsHCeUgV+edv6SZmJSkPUbnkDkbejW5tH0kxVuTACw
tvqi7pygV0aHlhRkRTwVIroqpOaiWJbMBbawmkkUDsfB22xXtBYW819iPOgbTEZt
ncaFZ2lABuhVYlHD5EgQ+mM/j4rPhbhoV0NxzU8w09zouaiOKISy8FQOPIif/jYR
nw3rv00SV0Bhzo77gfVO5ZEhFZyUD2ufYrf0vQz1L+CSyI3jtOk2J98jWbgWEbeu
AQIDAQABo4GHMIGEMB0GA1UdDgQWBBSpuOdb0GuapeSgnTDsiJN+lCUYdTAfBgNV
HSMEGDAWgBSpuOdb0GuapeSgnTDsiJN+lCUYdTAPBgNVHRMBAf8EBTADAQH/MDEG
A1UdEQQqMCiCEnd3dy5ncm93dG9waWExLmNvbYISd3d3Lmdyb3d0b3BpYTIuY29t
MA0GCSqGSIb3DQEBCwUAA4IBAQAaG+2EfOsmOkir2LNaAiz4KeaFEbcQn7oDZnHx
2PgESpGjnee+mt6EPcncZHjMX9RyPo88YBXKip/ofmr2Us3Lq80U34R87JdE70Hd
FDMIjgiFD21/uJjg15c8qhumWyCPvSyCCed2Pg2poK1tRHPyuZPfWZ7Qax74hiMH
DaokSLhMdg1XWpwKIIsfLZE97G/XidbcQY9YhuruOjHW4frn5pm9SfxjoJPYPOeE
u5KzJnj0XKT50hZjYd09oLbkSbwsoC4Knn10ia9tV4nyFaAdtSvLRvQbqBtz1JQ8
bIPhzARFjxeyra0M5931+84jV1rongILUwHB1Efs7z9B3J5G
-----END CERTIFICATE-----`;

class LoginServer {
  constructor() {
    this.logger = new Logger();
    this.servers = [];
    // Real Growtopia login endpoints — use IPs directly to bypass
    // the hosts file redirect (which points the domains to 127.0.0.1).
    // Each entry has the IP, the hostname (for TLS SNI + Host header),
    // and the path.
    this.realLoginEndpoints = [
      { ip: "23.59.80.217",  host: "www.growtopia1.com" },
      { ip: "23.59.80.203",  host: "www.growtopia1.com" },
      { ip: "34.234.161.35", host: "www.growtopia2.com" },
      { ip: "54.237.100.60", host: "www.growtopia2.com" },
      { ip: "54.204.235.73", host: "login.growtopiagame.com" },
      { ip: "98.90.113.253", host: "login.growtopiagame.com" },
    ];
  }

  /**
   * Fetch server_data from the REAL Growtopia server, then replace
   * the server/port with our proxy address. This ensures GT gets a
   * 100% valid response with all fields (loginurl, token, etc.)
   */
  fetchAndModifyServerData(postBody) {
    return new Promise((resolve) => {
      const proxyHost =
        config.proxy.host === "0.0.0.0" ? "127.0.0.1" : config.proxy.host;

      const tryEndpoint = (index) => {
        if (index >= this.realLoginEndpoints.length) {
          this.logger.warn("[LOGIN] All real GT servers unreachable, using fallback");
          resolve(this.getFallbackServerData());
          return;
        }

        const ep = this.realLoginEndpoints[index];
        this.logger.info(`[LOGIN] Trying ${ep.host} @ ${ep.ip}`);

        const reqOpts = {
          hostname: ep.ip,           // Connect to IP directly (bypasses hosts file)
          port: 443,
          path: "/growtopia/server_data.php",
          method: "POST",
          headers: {
            "Host": ep.host,         // Real hostname in Host header
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "UbiServices_SDK_2019.Release.27_PC64_ansi_static",
            "Content-Length": Buffer.byteLength(postBody),
          },
          servername: ep.host,       // TLS SNI — required for cert validation
          timeout: 5000,
          rejectUnauthorized: true,
        };

        const req = https.request(reqOpts, (resp) => {
          const chunks = [];
          resp.on("data", (c) => chunks.push(c));
          resp.on("end", () => {
            let body = Buffer.concat(chunks).toString();
            this.logger.info(
              `[LOGIN] ${ep.host} responded: ${resp.statusCode} (${body.length}b)`
            );

            if (resp.statusCode !== 200 || body.length < 20) {
              tryEndpoint(index + 1);
              return;
            }

            // Replace server + port with proxy address
            body = body.replace(
              /^server\|.+$/m,
              `server|${proxyHost}`
            );
            body = body.replace(
              /^port\|.+$/m,
              `port|${config.proxy.port}`
            );

            this.logger.info("[LOGIN] Modified server_data → proxy address");
            resolve(body);
          });
        });

        req.on("error", (err) => {
          this.logger.warn(`[LOGIN] ${ep.host}@${ep.ip} failed: ${err.message}`);
          tryEndpoint(index + 1);
        });

        req.on("timeout", () => {
          this.logger.warn(`[LOGIN] ${ep.host}@${ep.ip} timed out`);
          req.destroy();
          tryEndpoint(index + 1);
        });

        req.write(postBody);
        req.end();
      };

      tryEndpoint(0);
    });
  }

  /**
   * Fallback server_data when real GT servers can't be reached.
   */
  getFallbackServerData() {
    const proxyHost =
      config.proxy.host === "0.0.0.0" ? "127.0.0.1" : config.proxy.host;

    return [
      `server|${proxyHost}`,
      `port|${config.proxy.port}`,
      `type|1`,
      `#maint|Server is online. Good luck!`,
      `meta|dqymon-proxy`,
      `RTENDMARKERBS1001`,
    ].join("\n");
  }

  /**
   * Handle an HTTP request. Forwards to the real GT login server,
   * modifies the response, and sends it back to the game.
   */
  handleRequest(req, res) {
    // Collect POST body (Growtopia sends POST with form data)
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const postBody = Buffer.concat(chunks).toString();
      this.logger.info(
        `[LOGIN] ${req.method} ${req.url} ` +
        `(${req.headers.host || "no-host"}) ` +
        `body=${postBody.length}b`
      );

      this.fetchAndModifyServerData(postBody)
        .then((data) => {
          res.writeHead(200, {
            "Content-Type": "text/html",
            "Content-Length": Buffer.byteLength(data),
            "Connection": "close",
          });
          res.end(data);
          this.logger.info(`[LOGIN] Sent modified server_data (${data.length}b)`);
        })
        .catch((err) => {
          this.logger.error(`[LOGIN] Handler error: ${err.message}`);
          const fallback = this.getFallbackServerData();
          res.writeHead(200, {
            "Content-Type": "text/html",
            "Content-Length": Buffer.byteLength(fallback),
          });
          res.end(fallback);
        });
    });

    req.on("error", () => {
      const fallback = this.getFallbackServerData();
      res.writeHead(200);
      res.end(fallback);
    });
  }

  start() {
    const handler = (req, res) => this.handleRequest(req, res);

    // ── HTTPS on :443 ──────────────────────────────────────────────
    try {
      const httpsServer = https.createServer(
        { key: EMBEDDED_KEY, cert: EMBEDDED_CERT },
        handler
      );

      httpsServer.on("tlsClientError", () => {
        // Silently ignore TLS errors (cert rejection etc.)
      });

      httpsServer.listen(443, "0.0.0.0", () => {
        this.logger.info("✓ Login server listening on HTTPS :443");
      });

      httpsServer.on("error", (err) => {
        this.logger.warn(`HTTPS :443 failed: ${err.code || err.message}`);
      });

      this.servers.push(httpsServer);
    } catch (err) {
      this.logger.warn(`HTTPS setup failed: ${err.message}`);
    }

    // ── HTTP on :80 ────────────────────────────────────────────────
    try {
      const httpServer = http.createServer(handler);

      httpServer.listen(80, "0.0.0.0", () => {
        this.logger.info("✓ Login server listening on HTTP :80");
      });

      httpServer.on("error", (err) => {
        this.logger.warn(`HTTP :80 failed: ${err.code || err.message}`);
      });

      this.servers.push(httpServer);
    } catch (err) {
      this.logger.warn(`HTTP setup failed: ${err.message}`);
    }

    // ── Raw TCP on :443 fallback ───────────────────────────────────
    // Some GT versions send a plain HTTP request to :443 when HTTPS
    // fails. This raw TCP server detects whether the incoming
    // connection is TLS or plain HTTP and handles both.
    // We skip this if HTTPS :443 already bound successfully.
    // (handled by error above — if :443 is taken, this won't bind either)

    // ── HTTP on :8080 (guaranteed no-privilege port) ───────────────
    try {
      const httpAlt = http.createServer(handler);

      httpAlt.listen(8080, "0.0.0.0", () => {
        this.logger.info("✓ Login server listening on HTTP :8080 (alt)");
      });

      httpAlt.on("error", (err) => {
        this.logger.warn(`HTTP :8080 failed: ${err.code || err.message}`);
      });

      this.servers.push(httpAlt);
    } catch (err) {
      this.logger.warn(`HTTP :8080 setup failed: ${err.message}`);
    }
  }

  /**
   * Run diagnostics to help debug connection issues.
   */
  diagnose() {
    return new Promise((resolve) => {
      const results = [];

      // Test if we can connect to our own server on :443
      const test = (port, label) => {
        return new Promise((res) => {
          const sock = net.createConnection({ host: "127.0.0.1", port }, () => {
            results.push(`  ✓ Port ${port} (${label}) — reachable`);
            sock.destroy();
            res();
          });
          sock.on("error", (err) => {
            results.push(`  ✗ Port ${port} (${label}) — ${err.code || err.message}`);
            res();
          });
          sock.setTimeout(2000, () => {
            results.push(`  ✗ Port ${port} (${label}) — timeout`);
            sock.destroy();
            res();
          });
        });
      };

      Promise.all([
        test(443, "HTTPS"),
        test(80, "HTTP"),
        test(8080, "HTTP alt"),
      ]).then(() => {
        this.logger.info("Login server diagnostics:\n" + results.join("\n"));
        resolve(results);
      });
    });
  }

  stop() {
    for (const server of this.servers) {
      try { server.close(); } catch {}
    }
    this.servers = [];
  }
}

module.exports = LoginServer;
