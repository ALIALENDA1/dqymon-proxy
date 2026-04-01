const https = require("https");
const http = require("http");
const net = require("net");
const config = require("../config/config");
const Logger = require("./Logger");

// Embedded self-signed certificate for Growtopia domains
// Valid for 10 years — no openssl dependency needed.
const EMBEDDED_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCrWMnrK7aTwklm
Xo0aiT5oZhPBjBtj9uGrponKIp1UFhqhpAYxWtkU9X/yhzbiA3yMYWb7MNx0E0a2
5s825ekuYbYjmFuRCNtOREB52y1fitBVUOmMunBQ4/Wj+aEk0aylc6qOnO2gYo50
fCy9MMqf6xRweUtamRINbfrhV9FbuRRWchRoxJaKqqk5Zou1/1QRsCV6SdLKZnYN
aLmChg4/m0FkdmACToN7TwaGJgvzVK6EmF0hdVp5CChqOvbhuNzCI7QVbgB2saoX
B/v8E5FYJXAVgGJVfgtMLjx/bhEUGtSLIm40VTxW5mWosfzn8RjmMgfikXuBvnnr
k6NmB6+fAgMBAAECggEASD8ivD7tN7YW3swFMOgnYTuRHu2lauvg0VBiDtGzho3f
YsJXPh4xI+4zqZ4rnPadYE99bXJ3sZWjHmGJg3tDa6QVeUK3cRrL5V9P1FF++yb7
ms2H/CdsTh8gJqiNsomaAxUXGBTA+Pw1VpY5Avh8pxsmvhnWlPevrevueW9evg5G
D5yExSXuY1MRGJ7qU8rrwAs6jOLhG8hRrsAIoWXgKu54JKfnvnE8m5MBKxTgrYJk
ug66KoMuwMvroh2rm+NdIdTMRfllq7fuw8zA99chzlZ3IyjlRZoSxoN/f5GsnTwt
jCBoMH7zfZHt84sSYoSW1Sfk84TMD2r7PcslOUsJMQKBgQDRyoG0+AjIFAoMOJeS
xmQvKnUD7Er/MxnXhhMhTixXYz2+BhkEXPRxc/TD2OjZUZhk5hMt52Oy/sP4SfRM
G8S4yoRj5h0H1f39U4oJuhkLwG/px0tcciaSgNyN+5V63Ht1ruT50CeGAFCp9WY5
3xTpCFF+ft5aeBCr3NWzYLJPiQKBgQDRFob877G0FenOd9OfoYY6ySsnaJwr08Np
Lys0+IH7HNH+CS3bNj7VPPyz7CvBX09WXzjyVJlAyt5g95DixUvRSB7OrnZf2W5F
iMBpE3FzZKkM7aUpxfYg5gQmFqoy5U1RnAxZ2/ul74QNV5asbJ5AgfpYknV6qJRe
S5rOp/TT5wKBgQCRdvsNAlcEdHCrHKpsyUc6NRRCDhvKbCJlAMBO/addSKDNG+lI
zzNnX2G+Uq7R0PP8MlPmJmVI/cHgbVcJVs/G2hWGN0612jls5/n02Kb5MQvoa5nj
lfsM5nEHugRh1nN8nDKEzUI6dgl4b4HcasRS+MOZFFsVG99ja5J5+HhrEQKBgBd6
XxgB1kNxfnqHrAStv4PUWPso3Phy4+tot4JQMVBAMThEUZje43lQStPtPhCNojwB
n0ReyYKkBQqAYg2Et/m9DnCI2JP0t1QpgemKnF+nuu/Ps48YQoX5LhgUzXG/m8oB
KsXgVMaSOZLB9hJQdAisT68oaval/VsFRFHWPECbAoGBAJ5wgxjNgHLoONdzyPaC
tA0eZbQMj4ph4MngnCqRiF4k9M1RHZbM8wTeIHoBVKCUk0G5ZMjyuFTbUale4mXB
CsMJtKEYcRWQ9vExtp0ves93tWuRktEN1EF45r6cMBXzqaeN5sJXOX5jS5EET4vk
6zgZF40j6iIleDewuYPfyzpI
-----END PRIVATE KEY-----`;

const EMBEDDED_CERT = `-----BEGIN CERTIFICATE-----
MIIDiTCCAnGgAwIBAgIUC6Ie5Zh5KCPOX7woK+05NZJxbPMwDQYJKoZIhvcNAQEL
BQAwHTEbMBkGA1UEAwwSd3d3Lmdyb3d0b3BpYTEuY29tMB4XDTI2MDQwMTEwMTYx
NVoXDTM2MDMyOTEwMTYxNVowHTEbMBkGA1UEAwwSd3d3Lmdyb3d0b3BpYTEuY29t
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq1jJ6yu2k8JJZl6NGok+
aGYTwYwbY/bhq6aJyiKdVBYaoaQGMVrZFPV/8oc24gN8jGFm+zDcdBNGtubPNuXp
LmG2I5hbkQjbTkRAedstX4rQVVDpjLpwUOP1o/mhJNGspXOqjpztoGKOdHwsvTDK
n+sUcHlLWpkSDW364VfRW7kUVnIUaMSWiqqpOWaLtf9UEbAleknSymZ2DWi5goYO
P5tBZHZgAk6De08GhiYL81SuhJhdIXVaeQgoajr24bjcwiO0FW4AdrGqFwf7/BOR
WCVwFYBiVX4LTC48f24RFBrUiyJuNFU8VuZlqLH85/EY5jIH4pF7gb5565OjZgev
nwIDAQABo4HAMIG9MB0GA1UdDgQWBBTGlJ14Tt28B3fP4McA11e/Cch4IDAfBgNV
HSMEGDAWgBTGlJ14Tt28B3fP4McA11e/Cch4IDAPBgNVHRMBAf8EBTADAQH/MGoG
A1UdEQRjMGGCEnd3dy5ncm93dG9waWExLmNvbYISd3d3Lmdyb3d0b3BpYTIuY29t
ghdsb2dpbi5ncm93dG9waWFnYW1lLmNvbYIOZ3Jvd3RvcGlhMS5jb22CDmdyb3d0
b3BpYTIuY29tMA0GCSqGSIb3DQEBCwUAA4IBAQALWZqROWl2CadsEDO+Zrx9nsnm
Hs9rSAUgez0EzCFosd38vQxmsZCb1Ot6HpR4NLUY4Xz3INgWwUtbJhPDBBIe+sf6
unOXojkjXNJey+n31zyGjqKwfQcnAiVexkXuc5R21i2H/yCmMHPRmwMjxmeBD643
F+QH5te2hpq2ATFEA0GGSKYf7exz5+3vpWDgG+T5Q7rCt2KZ7ypaHZR54NlRVhkS
tTxIplUkzdDVt3tPo3k93vMDxcQRFfmrptqyVUOJQyZWdNVmYv/1xA4L+Grze+H2
C7fR6CdoBZioeEOIaCoa3z4hSOXpAWNmIEYBBjn4+isin3v93f8ldArUrqT3
-----END CERTIFICATE-----`;

class LoginServer {
  constructor() {
    this.logger = new Logger();
    this.servers = [];
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

            // Extract the REAL server IP and port before replacing
            const serverMatch = body.match(/^server\|(.+)$/m);
            const portMatch = body.match(/^port\|(.+)$/m);
            if (serverMatch) this.realServerHost = serverMatch[1].trim();
            if (portMatch) this.realServerPort = parseInt(portMatch[1].trim(), 10);
            this.logger.info(`[LOGIN] Real GT server: ${this.realServerHost}:${this.realServerPort}`);

            // Replace server + port with proxy address
            body = body.replace(
              /^server\|.+$/m,
              `server|${proxyHost}`
            );
            body = body.replace(
              /^port\|.+$/m,
              `port|${config.proxy.port}`
            );

            // Rewrite loginurl to our proxy so the auth request
            // doesn't try to verify our self-signed cert independently
            body = body.replace(
              /^loginurl\|.+$/m,
              `loginurl|${proxyHost}`
            );

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

            // Strip error/maint/url lines — GT's real server often
            // returns "error|1000|Update required" or "#maint|..."
            // which forces a retry/update loop instead of connecting.
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
      `type2|1`,
      `#maint|Server is online. Good luck!`,
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

    this.logger.info(`[LOGIN] Proxying ${origReq.method} ${origReq.url} → ${ep.host} @ ${ep.ip}`);

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
        const respBody = Buffer.concat(chunks);
        this.logger.info(`[LOGIN] Proxied ${origReq.url} → ${resp.statusCode} (${respBody.length}b)`);
        origRes.writeHead(resp.statusCode, resp.headers);
        origRes.end(respBody);
      });
    });

    proxyReq.on("error", (err) => {
      this.logger.warn(`[LOGIN] Proxy raw error: ${err.message}`);
      origRes.writeHead(502, { "Content-Type": "text/plain" });
      origRes.end("Proxy error");
    });

    proxyReq.on("timeout", () => {
      this.logger.warn(`[LOGIN] Proxy raw timeout for ${origReq.url}`);
      proxyReq.destroy();
      origRes.writeHead(504, { "Content-Type": "text/plain" });
      origRes.end("Timeout");
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  }

  /**
   * Handle an HTTP request. Forwards to the real GT login server,
   * modifies the response, and sends it back to the game.
   */
  handleRequest(req, res, protocol) {
    // Collect POST body (Growtopia sends POST with form data)
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const postBody = Buffer.concat(chunks).toString();
      this.logger.info(
        `[LOGIN] ${protocol} ${req.method} ${req.url} ` +
        `(${req.headers.host || "no-host"}) ` +
        `body=${postBody.length}b`
      );

      // Only modify /growtopia/server_data.php — everything else is
      // transparently proxied to the real GT server at the correct IP.
      if (!req.url || !req.url.includes("/growtopia/server_data.php")) {
        this.logger.info(`[LOGIN] Transparent proxy: ${req.url}`);
        this.proxyRawRequest(req, res, postBody);
        return;
      }

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
    const httpsHandler = (req, res) => this.handleRequest(req, res, "HTTPS");
    const httpHandler = (req, res) => this.handleRequest(req, res, "HTTP");

    // ── HTTPS on :443 ──────────────────────────────────────────────
    try {
      const httpsServer = https.createServer(
        { key: EMBEDDED_KEY, cert: EMBEDDED_CERT },
        httpsHandler
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
      const httpServer = http.createServer(httpHandler);

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
      const httpAlt = http.createServer(httpHandler);

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
