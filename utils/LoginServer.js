const https = require("https");
const http = require("http");
const net = require("net");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const config = require("../config/config");
const Logger = require("./Logger");

// Embedded self-signed certificate for Growtopia domains
// Valid for 10 years — no openssl dependency needed.
const EMBEDDED_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCsBU9euV5ir6DA
50Q9lrr83fDUqRSJIaDw2ydz5pMpToS8ZZMhvCjEo3Y1zfy2ZQY5hphMjqHL49Xe
vewWqgGMRs6mIL8ZL6HjoteL8Fhe2uvSoJS5AKSTElmyYzPyr5H66Z+/Tur6TMzG
ezh+ePWaP94x5mOHgmUIMyJ61N41ZEQALiDdoCFbZCpjjl498NIi30uRJH+mRF60
vGGpZl7kqgeJJUW6lGcRm4EN8KI6Uaa13a4dWRf05MBBWa/v9qEcgLdL3DazCrI6
QKooOc+B80UWjqsC7HSs93eWP9+7J5OXYObZHSA0VitqexWcPX12Hdge4WmE3kvN
hcReXR4DAgMBAAECggEAAZ6EEL5qYz/c2p6oAHOFbxE9FN/QyMfi6++yYu3KeGH0
0zvTT5w0BglgTiTnj54ufUM+L0+hSAhCUjgz4nueS6rX2OaydATnpolVbEvKbLaY
KMi6K+AT5WPW1E4labNkfGEIXiLas2Bz6XF77cMOmv/CdeQBug2zt4juWifcIWD1
K9PDf/d5MulFwWMjrbsiOQGHFu0a55Xui6eF+cr4bCt6nDfVkgmF3l4n5Y8HW0rl
ixVSrn857TwEkXXk4uWxxnrXZhnjXk4aI5c7AIjG5MyDn0Y4nK9lRqkaCX3aga9V
gnm2m+lRrxjZhU+gR/kLOOVaqqmu/qVWmV1ihl5DgQKBgQDVmbuuqpDUOJH/rV5M
e3HYFyK2ZW9pfunbD2cdErVGIrWZshCxkCcVR+P3VQhxG/JtG5cYTdCNLY8Kuo/l
Dk89Bpf0pUHybWczHXu2VkMS1xhBql0I7COjEoQnqICWUatlmfb/0gFfMrP3G4VH
Dsp3cAxpabOkjqcMJKpZYPASLwKBgQDOKquIQmzhio5iyKEOcpLqT4dsxl6/XZmh
PERcY2TtN9oB4puVO8WFG2mwBPj2+sM2Yh+skj71vvdEOKvcoMRwAHFjFvHReKvL
37SRbYlrC4/08Jfb5zI9wL+/uoTSFnY+NRFKgN4K+k+wRrzke4/yCYSE1U9jEqpf
69CU9bigbQKBgQDOd09HQm/D8vqM3ZOs8hXU/mf7TokmvBpoOLc/DvpR1PMcoVYp
jGF63IaqaHNEgfMPLAAc6fqQvFzrzfGRQweswVbYj3TzVHTQn8sZMMCc0XUM5BQR
r8+yrQ85FlNU+ZRnHS/3j5Lr5iK21M87JDzovlIBAr82bP1ja32N73me2QKBgQCM
+4DxXPs4AJf91VTNnGv67wecyspf8pHsQFo/E3kg/uCGCYB7PLSFoYlUZRIbUr/L
oK4oRJnpUv2kGVztMsMiFCt1p2sV438Xm5LPICiomu+GgEBYkHE66WQ2qEXLpLCX
OZLpb9Zni2STFsx1MkntKbUFYRk4lrsLfSbVtnLawQKBgHoqZtldrYkG4JvGAtIr
Xn7o/Jj1vj6iAs0DdeEo7fh1QV270DTX13GNboJopX14y0v2tiEpQDG/L1PWLEv/
tPdYELdQU5DrY+AZOawKhIFysBkoUY1eDaN0ZQVroe1XtLqhR246/AzZaF8I++vD
A4+IkFrMozsmwwoS4fMu2+lw
-----END PRIVATE KEY-----`;

const EMBEDDED_CERT = `-----BEGIN CERTIFICATE-----
MIIDjzCCAnegAwIBAgIUaMMGZu0yM5WbLko1WEzYvqkLKoQwDQYJKoZIhvcNAQEL
BQAwHTEbMBkGA1UEAwwSd3d3Lmdyb3d0b3BpYTEuY29tMB4XDTI2MDQwMTExMzE1
N1oXDTM2MDMyOTExMzE1N1owHTEbMBkGA1UEAwwSd3d3Lmdyb3d0b3BpYTEuY29t
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArAVPXrleYq+gwOdEPZa6
/N3w1KkUiSGg8Nsnc+aTKU6EvGWTIbwoxKN2Nc38tmUGOYaYTI6hy+PV3r3sFqoB
jEbOpiC/GS+h46LXi/BYXtrr0qCUuQCkkxJZsmMz8q+R+umfv07q+kzMxns4fnj1
mj/eMeZjh4JlCDMietTeNWREAC4g3aAhW2QqY45ePfDSIt9LkSR/pkRetLxhqWZe
5KoHiSVFupRnEZuBDfCiOlGmtd2uHVkX9OTAQVmv7/ahHIC3S9w2swqyOkCqKDnP
gfNFFo6rAux0rPd3lj/fuyeTl2Dm2R0gNFYransVnD19dh3YHuFphN5LzYXEXl0e
AwIDAQABo4HGMIHDMB0GA1UdDgQWBBQUn7yvYjjPnYYKnKpxTTccQg4O5zAfBgNV
HSMEGDAWgBQUn7yvYjjPnYYKnKpxTTccQg4O5zAPBgNVHRMBAf8EBTADAQH/MHAG
A1UdEQRpMGeCEnd3dy5ncm93dG9waWExLmNvbYISd3d3Lmdyb3d0b3BpYTIuY29t
ghdsb2dpbi5ncm93dG9waWFnYW1lLmNvbYIOZ3Jvd3RvcGlhMS5jb22CDmdyb3d0
b3BpYTIuY29thwR/AAABMA0GCSqGSIb3DQEBCwUAA4IBAQCUV5eaFt9FSM94fUio
/IrNAZmG8NhFR6+AsGWoiW/H//ETlqQ4MUAJqy6rwivbwOJdXEgKUwse66fHGn9W
lKUAr+AWRAnumwzD16EcOzbPIzShVegwvaTr9w9yhanM3Q64cid9j0rajYijKsL8
nFYJam2zqrreo1dnU8XVHl7dAlmWzuryxFWr6CJUWVvKxE83nLqzmFeJUSFDh1g6
/tscqUPlvhPzYAtpHyhOpW8H3Eax7TEYwGsjb4aSsJ1VXcBsi/yF2wh/bfBJSgPm
l/ERC+VsRpSe1W0Wb2EXImGKeVu+bCKPESh1dG9jjSd5sF2HuJ0JH6WkNdP3CiCq
Lqkk
-----END CERTIFICATE-----`;

// Allowed hostnames — only proxy requests for known GT domains
const ALLOWED_HOSTS = new Set([
  "www.growtopia1.com",
  "www.growtopia2.com",
  "login.growtopiagame.com",
  "growtopia1.com",
  "growtopia2.com",
]);

// Max POST body size (64 KB — GT login bodies are <1 KB)
const MAX_BODY_SIZE = 64 * 1024;

// Rate limiting: max requests per IP per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30;              // 30 requests/min

/**
 * Sanitize a URL for logging — strip tokens, keys, and long query strings.
 */
function sanitizeUrl(url) {
  if (!url) return "(none)";
  try {
    const qIdx = url.indexOf("?");
    if (qIdx === -1) return url;
    const path = url.substring(0, qIdx);
    const query = url.substring(qIdx + 1);
    // Replace token/key values with [REDACTED]
    const cleaned = query.replace(
      /(token|valKey|key|session|auth)=[^&]*/gi,
      "$1=[REDACTED]"
    );
    // Truncate if still very long
    if (cleaned.length > 80) return path + "?" + cleaned.substring(0, 80) + "...";
    return path + "?" + cleaned;
  } catch {
    return url.length > 120 ? url.substring(0, 120) + "..." : url;
  }
}

class LoginServer {
  constructor() {
    this.logger = new Logger();
    this.servers = [];
    this.certInstalled = false;
    this.rateLimitMap = new Map(); // ip -> { count, resetTime }
    this.gameLog = null; // set externally by index.js
    // The real GT server address/port extracted from the login response.
    // index.js reads these to know where to connect via ENet.
    this.realServerHost = null;
    this.realServerPort = null;
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
   * Check rate limit for an IP. Returns true if allowed, false if blocked.
   */
  checkRateLimit(ip) {
    const now = Date.now();
    const entry = this.rateLimitMap.get(ip);
    if (!entry || now > entry.resetTime) {
      this.rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
      this.logger.warn(`[LOGIN] Rate limit exceeded for ${ip} (${entry.count} requests)`);
      return false;
    }
    return true;
  }

  /**
   * Fetch server_data from the REAL Growtopia server, then replace
   * the server/port with our proxy address. This ensures GT gets a
   * 100% valid response with all fields (loginurl, token, etc.)
   * @param {string} postBody - POST body from GT client
   * @param {string} [preferHost] - Preferred host from incoming request's Host header
   */
  fetchAndModifyServerData(postBody, preferHost) {
    return new Promise((resolve) => {
      const proxyHost =
        config.proxy.host === "0.0.0.0" ? "127.0.0.1" : config.proxy.host;

      // Guard flag: prevents resolve/tryEndpoint from being called more
      // than once.  Without this, timeout → req.destroy() → error would
      // fork the retry chain, creating duplicate parallel branches that
      // race to overwrite realServerHost/Port and send multiple responses.
      let done = false;

      // Reorder endpoints so preferred host is tried first
      let endpoints = [...this.realLoginEndpoints];
      if (preferHost) {
        const cleaned = preferHost.split(":")[0].toLowerCase();
        const preferred = endpoints.filter(ep => ep.host.toLowerCase() === cleaned);
        const rest = endpoints.filter(ep => ep.host.toLowerCase() !== cleaned);
        endpoints = [...preferred, ...rest];
      }

      const tryEndpoint = (index) => {
        if (done) return;          // already resolved — stop this branch

        if (index >= endpoints.length) {
          done = true;
          this.logger.warn("[LOGIN] All real GT servers unreachable, using fallback");
          resolve(this.getFallbackServerData());
          return;
        }

        const ep = endpoints[index];
        this.logger.info(`[LOGIN] Trying ${ep.host} @ ${ep.ip}`);

        let moved = false;         // per-endpoint guard against timeout+error double-fire

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
            if (done) return;       // another branch already resolved

            let body = Buffer.concat(chunks).toString();
            this.logger.info(
              `[LOGIN] ${ep.host} responded: ${resp.statusCode} (${body.length}b)`
            );

            if (resp.statusCode !== 200 || body.length < 20) {
              if (!moved) { moved = true; tryEndpoint(index + 1); }
              return;
            }

            // Extract the REAL server IP and port before replacing
            const serverMatch = body.match(/^server\|(.+)$/m);
            const portMatch = body.match(/^port\|(.+)$/m);
            const loginUrlMatch = body.match(/^loginurl\|(.+)$/m);
            if (serverMatch) this.realServerHost = serverMatch[1].trim();
            if (portMatch) this.realServerPort = parseInt(portMatch[1].trim(), 10);
            this.logger.info(`[LOGIN] Real GT server: ${this.realServerHost}:${this.realServerPort}`);
            if (loginUrlMatch) this.logger.info(`[LOGIN] loginurl: ${loginUrlMatch[1].trim()}`);

            // Detect maintenance flag (note: server often still accepts connections)
            const maintMatch = body.match(/^#maint\|(.+)$/m);
            if (maintMatch) {
              this.maintenanceDetected = true;
              this.logger.info(`[LOGIN] server_data has #maint flag: ${maintMatch[1].trim()}`);
              this.logger.info(`[LOGIN] (server may still accept connections despite this flag)`);
            } else {
              this.maintenanceDetected = false;
            }

            // Log the original response before modification
            this.logger.info(`[LOGIN] Original server_data:\n${body}`);

            // Replace server + port with proxy address
            body = body.replace(
              /^server\|.+$/m,
              `server|${proxyHost}`
            );
            body = body.replace(
              /^port\|.+$/m,
              `port|${config.proxy.port}`
            );

            // DO NOT rewrite loginurl — keep it as the original domain
            // (e.g. login.growtopiagame.com). The hosts file redirects
            // it to 127.0.0.1, and our cert has it as a SAN, so TLS
            // succeeds. If we rewrote to 127.0.0.1, TLS SNI would fail.

            // Force type2|1 — tells GT to skip the web-based login
            // flow (loginurl) and connect directly via ENet.
            if (/^type2\|/m.test(body)) {
              body = body.replace(/^type2\|.+$/m, "type2|1");
            } else {
              if (body.includes("RTENDMARKERBS1001")) {
                body = body.replace("RTENDMARKERBS1001", "type2|1\nRTENDMARKERBS1001");
              } else {
                body += "\ntype2|1";
              }
            }

            // Strip error/maint/url lines — GT's real server sends these
            // when it wants to force an update or maintenance screen.
            // url| is NOT loginurl| (which we keep) — url| redirects to
            // an update page that will return 404 through our proxy.
            body = body.replace(/^error\|.+$/gm, "");
            body = body.replace(/^url\|.+$/gm, "");
            body = body.replace(/^#maint\|.+$/gm, "");
            // Clean up blank lines left behind
            body = body.replace(/\n{2,}/g, "\n").trim();
            // Re-add trailing marker if stripped
            if (!body.includes("RTENDMARKERBS1001")) {
              body += "\nRTENDMARKERBS1001";
            }

            this.logger.info("[LOGIN] Modified server_data → proxy address (type2|1, stripped error/maint)");
            this.logger.info(`[LOGIN] server_data response body:\n${body}`);
            done = true;
            resolve(body);
          });
        });

        req.on("error", (err) => {
          if (done || moved) return;   // already resolved or already moved to next endpoint
          moved = true;
          this.logger.warn(`[LOGIN] ${ep.host}@${ep.ip} failed: ${err.message}`);
          tryEndpoint(index + 1);
        });

        req.on("timeout", () => {
          if (done || moved) return;
          moved = true;
          this.logger.warn(`[LOGIN] ${ep.host}@${ep.ip} timed out`);
          req.destroy();              // just close — don't call tryEndpoint from error too
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
      `type2|1`,
      `meta|dqymon-proxy`,
      `RTENDMARKERBS1001`,
    ].join("\n");
  }

  /**
   * Find the correct real endpoint IP for a given hostname.
   */
  resolveEndpoint(hostname) {
    if (!hostname) return this.realLoginEndpoints[0];
    const cleaned = hostname.split(":")[0].toLowerCase();
    const match = this.realLoginEndpoints.find(
      (ep) => ep.host.toLowerCase() === cleaned
    );
    return match || this.realLoginEndpoints[0];
  }

  /**
   * Proxy a non-server_data request to the real GT server,
   * forwarding the path, method, headers, and body as-is.
   * Routes to the correct real IP based on the Host header.
   */
  proxyRawRequest(origReq, origRes, body) {
    const incomingHost = (origReq.headers.host || "").split(":")[0];
    const ep = this.resolveEndpoint(incomingHost);

    this.logger.info(`[LOGIN] Proxying ${origReq.method} ${sanitizeUrl(origReq.url)} → ${ep.host} @ ${ep.ip}`);

    const reqOpts = {
      hostname: ep.ip,
      port: 443,
      path: origReq.url,
      method: origReq.method || "GET",
      headers: {
        ...origReq.headers,
        host: ep.host,
      },
      servername: ep.host,
      timeout: 8000,
      rejectUnauthorized: true,
    };
    // Remove connection-hop headers
    delete reqOpts.headers["connection"];
    delete reqOpts.headers["accept-encoding"];

    const proxyReq = https.request(reqOpts, (resp) => {
      const chunks = [];
      resp.on("data", (c) => chunks.push(c));
      resp.on("end", () => {
        if (origRes.destroyed) return;
        const respBody = Buffer.concat(chunks);
        this.logger.info(`[LOGIN] Proxied ${sanitizeUrl(origReq.url)} → ${resp.statusCode} (${respBody.length}b)`);
        if (resp.statusCode >= 400) {
          this.logger.warn(`[LOGIN] Non-OK response for ${sanitizeUrl(origReq.url)}: ${resp.statusCode} body=${respBody.toString().substring(0, 200)}`);
        }
        // Add security headers to prevent caching of auth responses
        const headers = { ...resp.headers };
        headers["cache-control"] = "no-store, no-cache, must-revalidate";
        headers["pragma"] = "no-cache";
        origRes.writeHead(resp.statusCode, headers);
        origRes.end(respBody);
      });
    });

    proxyReq.on("error", (err) => {
      this.logger.warn(`[LOGIN] Proxy raw error: ${err.message}`);
      if (!origRes.destroyed && !origRes.headersSent) {
        origRes.writeHead(502, { "Content-Type": "text/plain" });
        origRes.end("Proxy error");
      }
    });

    proxyReq.on("timeout", () => {
      this.logger.warn(`[LOGIN] Proxy raw timeout for ${sanitizeUrl(origReq.url)}`);
      proxyReq.destroy();
      if (!origRes.destroyed && !origRes.headersSent) {
        origRes.writeHead(504, { "Content-Type": "text/plain" });
        origRes.end("Timeout");
      }
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  }

  /**
   * Handle an HTTP request. Forwards to the real GT login server,
   * modifies the response, and sends it back to the game.
   */
  handleRequest(req, res, protocol) {
    const clientIp = req.socket.remoteAddress || "unknown";

    // ── Rate limiting ──────────────────────────────────────────────
    if (!this.checkRateLimit(clientIp)) {
      if (!res.destroyed) {
        res.writeHead(429, { "Content-Type": "text/plain", "Retry-After": "60" });
        res.end("Too many requests");
      }
      return;
    }

    // ── Host validation ── only proxy for known GT domains ────────
    const reqHost = (req.headers.host || "").split(":")[0].toLowerCase();
    if (reqHost && !ALLOWED_HOSTS.has(reqHost) && reqHost !== "127.0.0.1" && reqHost !== "localhost") {
      this.logger.warn(`[LOGIN] Rejected request for unknown host: ${reqHost}`);
      if (!res.destroyed) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
      }
      return;
    }

    // ── Collect POST body with size limit ──────────────────────────
    const chunks = [];
    let bodySize = 0;
    let aborted = false;

    req.on("data", (chunk) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        if (!aborted) {
          aborted = true;
          this.logger.warn(`[LOGIN] Request body too large (${bodySize}b) from ${clientIp}`);
          if (!res.destroyed) {
            res.writeHead(413, { "Content-Type": "text/plain" });
            res.end("Request too large");
          }
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (aborted) return;

      const postBody = Buffer.concat(chunks).toString();
      this.logger.info(
        `[LOGIN] ${protocol} ${req.method} ${sanitizeUrl(req.url)} ` +
        `(${reqHost || "no-host"}) ` +
        `body=${postBody.length}b`
      );

      // Only modify /growtopia/server_data.php — everything else is
      // transparently proxied to the real GT server at the correct IP.
      // Use flexible path matching in case GT changes the path slightly.
      const isServerData = req.url && (
        req.url.includes("/growtopia/server_data.php") ||
        req.url.includes("server_data.php")
      );

      if (!isServerData) {
        this.logger.info(`[LOGIN] Transparent proxy: ${sanitizeUrl(req.url)}`);
        this.proxyRawRequest(req, res, postBody);
        return;
      }

      this.fetchAndModifyServerData(postBody, req.headers.host)
        .then((data) => {
          if (res.destroyed) return;
          res.writeHead(200, {
            "Content-Type": "text/html",
            "Content-Length": Buffer.byteLength(data),
            "Connection": "close",
          });
          res.end(data);
          this.logger.info(`[LOGIN] Sent modified server_data (${data.length}b)`);
          if (this.gameLog) {
            this.gameLog.logLogin(true, `server_data → ${this.realServerHost}:${this.realServerPort}`);
          }
          // Notify proxy that a new login occurred — stale sessions should be cleared
          if (this.onNewLogin) {
            this.onNewLogin(this.realServerHost, this.realServerPort);
          }
        })
        .catch((err) => {
          this.logger.error(`[LOGIN] Handler error: ${err.message}`);
          if (this.gameLog) {
            this.gameLog.logLogin(false, `Error: ${err.message}`);
          }
          if (res.destroyed) return;
          const fallback = this.getFallbackServerData();
          res.writeHead(200, {
            "Content-Type": "text/html",
            "Content-Length": Buffer.byteLength(fallback),
          });
          res.end(fallback);
        });
    });

    req.on("error", () => {
      if (!res.destroyed && !res.headersSent) {
        try {
          const fallback = this.getFallbackServerData();
          res.writeHead(200);
          res.end(fallback);
        } catch {}
      }
    });
  }

  start() {
    const httpsHandler = (req, res) => this.handleRequest(req, res, "HTTPS");
    const httpHandler = (req, res) => this.handleRequest(req, res, "HTTP");

    // ── HTTPS on :443 ──────────────────────────────────────────────
    try {
      const httpsServer = https.createServer(
        { key: EMBEDDED_KEY, cert: EMBEDDED_CERT },
        httpsHandler
      );

      httpsServer.on("tlsClientError", (err, socket) => {
        this.logger.warn(`[LOGIN] TLS handshake error: ${err.message} from ${socket.remoteAddress || 'unknown'}`);
      });

      httpsServer.listen(443, "127.0.0.1", () => {
        this.logger.info("✓ Login server listening on HTTPS 127.0.0.1:443");
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
      const httpServer = http.createServer(httpHandler);

      httpServer.listen(80, "127.0.0.1", () => {
        this.logger.info("✓ Login server listening on HTTP 127.0.0.1:80");
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
      const httpAlt = http.createServer(httpHandler);

      httpAlt.listen(8080, "127.0.0.1", () => {
        this.logger.info("✓ Login server listening on HTTP 127.0.0.1:8080 (alt)");
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

  /**
   * Install the proxy's self-signed certificate into the Windows
   * Trusted Root Certification Authorities store.  This makes GT's
   * auth client (WinHTTP/SChannel) trust our HTTPS interception.
   * Requires Administrator privileges.
   */
  installCert() {
    if (process.platform !== "win32") return true;
    try {
      // Remove any leftover cert from a previous crashed run
      this.removeCert();

      const tmpCert = path.join(os.tmpdir(), "dqymon-proxy-cert.pem");
      fs.writeFileSync(tmpCert, EMBEDDED_CERT);
      execSync(`certutil -addstore -f Root "${tmpCert}"`, { stdio: "pipe" });
      try { fs.unlinkSync(tmpCert); } catch {}
      this.certInstalled = true;
      this.logger.info("✓ Proxy certificate installed in Windows trusted root store");
      return true;
    } catch (err) {
      this.logger.warn(`Could not install certificate (need admin?): ${err.message}`);
      return false;
    }
  }

  /**
   * Remove the proxy certificate from the Windows trust store.
   */
  removeCert() {
    if (process.platform !== "win32") return;
    try {
      // Remove by subject matching our CN (www.growtopia1.com)
      execSync(
        'powershell -Command "Get-ChildItem Cert:\\LocalMachine\\Root | ' +
        "Where-Object { $_.Subject -match 'growtopia' } | " +
        'Remove-Item -Force"',
        { stdio: "pipe" }
      );
      this.certInstalled = false;
      this.logger.info("✓ Proxy certificate removed from trust store");
    } catch {
      // May not exist — that's fine
    }
  }

  stop() {
    for (const server of this.servers) {
      try { server.close(); } catch {}
    }
    this.servers = [];
  }
}

module.exports = LoginServer;
