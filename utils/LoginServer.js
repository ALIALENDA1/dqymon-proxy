const https = require("https");
const http = require("http");
const config = require("../config/config");
const Logger = require("./Logger");

// Embedded self-signed certificate for www.growtopia1.com / www.growtopia2.com
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
    this.server = null;
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

    this.server = https.createServer(
      { key: EMBEDDED_KEY, cert: EMBEDDED_CERT },
      handler
    );

    this.server.listen(443, () => {
      this.logger.info("✓ Login server started on HTTPS :443");
    });

    this.server.on("error", (err) => {
      if (err.code === "EACCES" || err.code === "EADDRINUSE") {
        this.logger.warn(
          `HTTPS :443 failed (${err.code}). Trying HTTP :80 fallback...`
        );
        this.startHttp(handler);
      } else {
        this.logger.error(`Login server error: ${err.message}`);
      }
    });
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
