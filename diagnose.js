#!/usr/bin/env node
/**
 * dqymon-diagnose v2 — Growtopia connection diagnostic tool.
 *
 * Tests the ENTIRE login + ENet flow:
 *   1. HTTPS POST to real GT login servers -> fetches server_data
 *   2. Parses server IP, port, flags
 *   3. Sends ENet CONNECT with proper CRC32 checksums (GT requires them)
 *   4. RELAY TEST: Intercepts your real GT client's ENet packet and
 *      relays it to the server — proves whether UDP relay itself works
 *
 * RUN AS ADMINISTRATOR (needed for hosts file + port 17091).
 */

const https = require("https");
const dgram = require("dgram");
const dns = require("dns");
const fs = require("fs");
const readline = require("readline");

// ── Helpers ──────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function ok(msg) { console.log(`${GREEN}  \u2713${RESET} ${msg}`); }
function fail(msg) { console.log(`${RED}  \u2717${RESET} ${msg}`); }
function warn(msg) { console.log(`${YELLOW}  \u26A0${RESET} ${msg}`); }
function info(msg) { console.log(`${CYAN}  \u203A${RESET} ${msg}`); }
function header(msg) { console.log(`\n${BOLD}${msg}${RESET}`); }
function dim(msg) { console.log(`${DIM}    ${msg}${RESET}`); }

function pause(msg) {
  try {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(msg || "\nPress ENTER to exit...", () => { rl.close(); resolve(); });
    });
  } catch {
    return new Promise((resolve) => setTimeout(resolve, 30000));
  }
}

function hexDump(buf, max) {
  return buf.slice(0, Math.min(buf.length, max || 48))
    .toString("hex").match(/.{1,2}/g).join(" ");
}

// ── CRC32 (same polynomial as ENet) ─────────────────────────────────

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── GT Login Endpoints ───────────────────────────────────────────────

const GT_ENDPOINTS = [
  { ip: "23.59.80.217",  host: "www.growtopia1.com" },
  { ip: "23.59.80.203",  host: "www.growtopia1.com" },
  { ip: "34.234.161.35", host: "www.growtopia2.com" },
  { ip: "54.237.100.60", host: "www.growtopia2.com" },
  { ip: "54.204.235.73", host: "login.growtopiagame.com" },
  { ip: "98.90.113.253", host: "login.growtopiagame.com" },
];

const HOSTS_FILE = process.platform === "win32"
  ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
  : "/etc/hosts";
const GT_MARKER = "# dqymon-diagnose";
const GT_DOMAINS = [
  "www.growtopia1.com", "www.growtopia2.com",
  "login.growtopiagame.com", "growtopia1.com", "growtopia2.com",
];

// ── Step 1: Check hosts file ─────────────────────────────────────────

function checkHostsFile() {
  header("Step 1: Checking hosts file");
  try {
    const content = fs.readFileSync(HOSTS_FILE, "utf8");
    const proxyLines = content.split("\n").filter(l =>
      l.includes("growtopia") && !l.trim().startsWith("#")
    );
    if (proxyLines.length > 0) {
      warn("Hosts file has Growtopia redirects:");
      proxyLines.forEach(l => dim(l.trim()));
      return false;
    }
    ok("Hosts file is clean");
    return true;
  } catch (err) {
    warn(`Could not read hosts file: ${err.message}`);
    return true;
  }
}

// ── Step 2: DNS ──────────────────────────────────────────────────────

async function checkDns() {
  header("Step 2: DNS resolution");
  const domains = ["www.growtopia1.com", "www.growtopia2.com", "login.growtopiagame.com"];
  for (const domain of domains) {
    try {
      const addrs = await new Promise((resolve, reject) => {
        dns.resolve4(domain, (err, a) => err ? reject(err) : resolve(a));
      });
      ok(`${domain} \u2192 ${addrs.join(", ")}`);
    } catch (err) {
      fail(`${domain} \u2192 ${err.code || err.message}`);
    }
  }
}

// ── Step 3+4: HTTPS login ────────────────────────────────────────────

function fetchServerData(ep, postBody) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = https.request({
      hostname: ep.ip, port: 443,
      path: "/growtopia/server_data.php",
      method: "POST",
      headers: {
        "Host": ep.host,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "UbiServices_SDK_2019.Release.27_PC64_ansi_static",
        "Content-Length": Buffer.byteLength(postBody),
      },
      servername: ep.host,
      timeout: 8000,
      rejectUnauthorized: true,
    }, (resp) => {
      const chunks = [];
      resp.on("data", (c) => chunks.push(c));
      resp.on("end", () => {
        resolve({ ok: true, status: resp.statusCode, body: Buffer.concat(chunks).toString(), elapsed: Date.now() - start, ep });
      });
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message, ep }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "Timeout 8s", ep }); });
    req.write(postBody);
    req.end();
  });
}

async function testLogin() {
  header("Step 3: HTTPS login to GT servers");
  const postBody = "version=4.61&platform=0&deviceVersion=0";

  let bestResult = null;
  for (const ep of GT_ENDPOINTS) {
    info(`Trying ${ep.host} @ ${ep.ip}...`);
    const r = await fetchServerData(ep, postBody);
    if (!r.ok) { fail(`${ep.host}@${ep.ip}: ${r.error}`); continue; }
    if (r.status !== 200) { fail(`${ep.host}@${ep.ip}: HTTP ${r.status}`); continue; }
    ok(`${ep.host}@${ep.ip}: HTTP 200 (${r.body.length}b, ${r.elapsed}ms)`);
    bestResult = r;
    break;
  }

  if (!bestResult) { fail("All GT login servers unreachable!"); return null; }

  header("Step 4: Parsing server_data");
  const body = bestResult.body;
  const parsed = {};
  for (const line of body.split("\n")) {
    const i = line.indexOf("|");
    if (i !== -1) parsed[line.substring(0, i)] = line.substring(i + 1).trim();
  }

  dim("\u2500\u2500\u2500 Raw server_data \u2500\u2500\u2500");
  for (const line of body.split("\n")) {
    if (line.trim()) dim(line.length > 120 ? line.substring(0, 120) + "..." : line);
  }
  dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");

  const serverIP = parsed["server"];
  const serverPort = parseInt(parsed["port"], 10) || 17091;

  if (!serverIP) { fail("No server field in response!"); return null; }
  ok(`Game server: ${serverIP}:${serverPort}`);

  if (parsed["#maint"]) {
    warn(`MAINTENANCE FLAG present: "${parsed["#maint"]}"`);
    info("Note: #maint does NOT always mean the server is down.");
    info("GT clients can often still connect despite this flag.");
  } else {
    ok("No maintenance flag");
  }

  if (parsed["type2"]) info(`type2: ${parsed["type2"]}`);
  if (parsed["loginurl"]) info(`loginurl: ${parsed["loginurl"]}`);
  if (parsed["meta"]) info(`meta: ${parsed["meta"].substring(0, 60)}...`);

  return { ip: serverIP, port: serverPort, hasMaint: !!parsed["#maint"], rawBody: body };
}

// ── Step 5: ENet CONNECT with CRC32 ─────────────────────────────────

/**
 * Build a proper ENet CONNECT packet WITH CRC32 checksum.
 * GT's custom ENet silently drops packets without valid CRC32.
 *
 * Layout:
 *   [0..1]  peerID flags   (0x8FFF = sentTime + peerID 0xFFF)
 *   [2..3]  sentTime        (0)
 *   [4..7]  CRC32 checksum  (over entire datagram with this field zeroed)
 *   [8..11] command header   (CONNECT | ACK, channelID=0xFF, relSeq=1)
 *   [12..47] connect data    (36 bytes)
 */
function buildENetConnect() {
  const buf = Buffer.alloc(48);

  // Protocol header
  buf.writeUInt16BE(0x8FFF, 0);     // peerID=0xFFF + sentTime flag
  buf.writeUInt16BE(0, 2);          // sentTime
  // [4..7] = CRC32 placeholder (written below)

  // Command header at offset 8
  buf[8] = 0x82;                    // CONNECT(2) | ACK flag(0x80)
  buf[9] = 0xFF;                    // channelID
  buf.writeUInt16BE(1, 10);         // reliableSequenceNumber

  // Connect data at offset 12 (36 bytes)
  buf.writeUInt16BE(0, 12);         // outgoingPeerID
  buf[14] = 0xFF;                   // incomingSessionID
  buf[15] = 0xFF;                   // outgoingSessionID
  buf.writeUInt32BE(1400, 16);      // MTU
  buf.writeUInt32BE(32768, 20);     // windowSize
  buf.writeUInt32BE(2, 24);         // channelCount
  buf.writeUInt32BE(0, 28);         // incomingBandwidth
  buf.writeUInt32BE(0, 32);         // outgoingBandwidth
  buf.writeUInt32BE(5000, 36);      // packetThrottleInterval
  buf.writeUInt32BE(2, 40);         // packetThrottleAcceleration
  buf.writeUInt32BE(2, 44);         // packetThrottleDeceleration

  // Compute CRC32 with the checksum field zeroed
  buf.writeUInt32LE(0, 4);
  const checksum = crc32(buf);
  buf.writeUInt32LE(checksum, 4);

  return buf;
}

/**
 * Build variant WITHOUT sentTime flag.
 * Layout: [0..1] peerID (0x0FFF), [2..5] CRC32, [6..9] cmd header, [10..45] connect data
 */
function buildENetConnectNoSentTime() {
  const buf = Buffer.alloc(46);

  buf.writeUInt16BE(0x0FFF, 0);     // peerID=0xFFF, no sentTime

  // CRC32 at offset 2 (written below)
  // Command header at offset 6
  buf[6] = 0x82;
  buf[7] = 0xFF;
  buf.writeUInt16BE(1, 8);

  // Connect data at offset 10
  buf.writeUInt16BE(0, 10);
  buf[12] = 0xFF;
  buf[13] = 0xFF;
  buf.writeUInt32BE(1400, 14);
  buf.writeUInt32BE(32768, 18);
  buf.writeUInt32BE(2, 22);
  buf.writeUInt32BE(0, 26);
  buf.writeUInt32BE(0, 30);
  buf.writeUInt32BE(5000, 34);
  buf.writeUInt32BE(2, 38);
  buf.writeUInt32BE(2, 42);

  buf.writeUInt32LE(0, 2);
  const checksum = crc32(buf);
  buf.writeUInt32LE(checksum, 2);

  return buf;
}

/**
 * Build variant: NO CRC32, WITH sentTime (standard ENet, no checksum).
 */
function buildENetConnectNoCRC() {
  const buf = Buffer.alloc(44);

  buf.writeUInt16BE(0x8FFF, 0);
  buf.writeUInt16BE(0, 2);

  // Command at offset 4 (no checksum)
  buf[4] = 0x82;
  buf[5] = 0xFF;
  buf.writeUInt16BE(1, 6);

  // Connect data at offset 8
  buf.writeUInt16BE(0, 8);
  buf[10] = 0xFF;
  buf[11] = 0xFF;
  buf.writeUInt32BE(1400, 12);
  buf.writeUInt32BE(32768, 16);
  buf.writeUInt32BE(2, 20);
  buf.writeUInt32BE(0, 24);
  buf.writeUInt32BE(0, 28);
  buf.writeUInt32BE(5000, 32);
  buf.writeUInt32BE(2, 36);
  buf.writeUInt32BE(2, 40);

  return buf;
}

function testENetConnection(serverIP, serverPort) {
  return new Promise((resolve) => {
    header("Step 5: ENet UDP connection test (with CRC32)");
    info(`Target: ${serverIP}:${serverPort}`);
    info("Trying 3 packet formats: CRC32+sentTime, CRC32-only, no-CRC32");

    let anyResponded = false;
    const sockets = [];

    const variants = [
      { label: "CRC32+sentTime", packet: buildENetConnect() },
      { label: "CRC32-noSentTime", packet: buildENetConnectNoSentTime() },
      { label: "NoCRC32+sentTime", packet: buildENetConnectNoCRC() },
    ];

    for (const v of variants) {
      const sock = dgram.createSocket("udp4");
      sockets.push(sock);

      sock.on("message", (msg, rinfo) => {
        if (!anyResponded) {
          anyResponded = true;
          ok(`${v.label}: RESPONSE! ${msg.length}b from ${rinfo.address}:${rinfo.port}`);
          dim(`Response hex: ${hexDump(msg, 48)}`);
        }
      });

      sock.on("error", () => {});

      dim(`${v.label} (${v.packet.length}b): ${hexDump(v.packet, 48)}`);

      sock.send(v.packet, serverPort, serverIP, (err) => {
        if (err) {
          fail(`${v.label}: Send failed: ${err.message}`);
        } else {
          const addr = sock.address();
          ok(`${v.label}: Sent from :${addr.port}`);
        }
      });
    }

    // Retransmit after 3s
    setTimeout(() => {
      if (anyResponded) return;
      info("Retransmitting all variants...");
      variants.forEach((v, i) => {
        try { sockets[i].send(v.packet, serverPort, serverIP, () => {}); } catch {}
      });
    }, 3000);

    // Retransmit after 6s
    setTimeout(() => {
      if (anyResponded) return;
      info("Final retransmit...");
      variants.forEach((v, i) => {
        try { sockets[i].send(v.packet, serverPort, serverIP, () => {}); } catch {}
      });
    }, 6000);

    setTimeout(() => {
      sockets.forEach(s => { try { s.close(); } catch {} });
      if (!anyResponded) {
        fail("No response from any ENet CONNECT variant after 10s");
        info("This does NOT mean the server is down!");
        info("GT likely uses a custom ENet handshake that we can't replicate.");
        info("The RELAY TEST (next) will use your REAL GT client's packet.");
      }
      resolve({ anyResponded });
    }, 10000);
  });
}

// ── Step 6: RELAY TEST ──────────────────────────────────────────────
// This is the CRITICAL test. It does exactly what the proxy does:
//   - Start an HTTPS server on port 443 to serve modified server_data
//   - Listen on UDP port 17091 for ENet packets
//   - Install our cert so GT trusts our HTTPS server
//   - Redirect GT domains to 127.0.0.1 via hosts file
//   - Wait for the real GT client to complete login + send ENet
//   - Relay the EXACT ENet bytes to the real GT server
//   - See if we get a response
//
// If relay gets a response -> the proxy's mechanism works
// If relay fails -> something on this machine prevents UDP relay

// Embedded self-signed cert (same as proxy's LoginServer)
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

function modifyHostsForRelay() {
  try {
    let hosts = fs.readFileSync(HOSTS_FILE, "utf8");
    hosts = hosts.split("\n").filter(l => !l.includes(GT_MARKER)).join("\n");
    const entries = GT_DOMAINS.map(d => `127.0.0.1 ${d} ${GT_MARKER}`).join("\n");
    hosts = hosts.trimEnd() + "\n" + entries + "\n";
    fs.writeFileSync(HOSTS_FILE, hosts);
    return true;
  } catch (err) {
    fail(`Cannot modify hosts file: ${err.message}`);
    if (err.code === "EACCES" || err.code === "EPERM") {
      fail("RUN AS ADMINISTRATOR!");
    }
    return false;
  }
}

function restoreHosts() {
  try {
    let hosts = fs.readFileSync(HOSTS_FILE, "utf8");
    hosts = hosts.split("\n").filter(l => !l.includes(GT_MARKER)).join("\n");
    fs.writeFileSync(HOSTS_FILE, hosts);
    ok("Hosts file restored");
  } catch {}
}

function installCert() {
  if (process.platform !== "win32") return false;
  try {
    const tmpCert = require("path").join(require("os").tmpdir(), "dqymon-diagnose-cert.crt");
    fs.writeFileSync(tmpCert, EMBEDDED_CERT);
    require("child_process").execSync(
      `certutil -addstore -f Root "${tmpCert}" >nul 2>&1`,
      { stdio: "pipe" }
    );
    try { fs.unlinkSync(tmpCert); } catch {}
    ok("Certificate installed to Trusted Root store");
    return true;
  } catch (err) {
    warn(`Could not install cert: ${err.message}`);
    info("If GT shows SSL errors, install the cert manually.");
    return false;
  }
}

function removeCert() {
  if (process.platform !== "win32") return;
  try {
    require("child_process").execSync(
      'certutil -delstore Root "www.growtopia1.com" >nul 2>&1',
      { stdio: "pipe" }
    );
  } catch {}
}

/**
 * Start a minimal HTTPS server that serves modified server_data
 * pointing the game to 127.0.0.1:17091 (our UDP listener).
 * Non-server_data requests are proxied to the real GT server.
 */
function startRelayHttpsServer(serverDataBody) {
  return new Promise((resolve, reject) => {
    const http = require("http");

    // Modify server_data: point to our UDP listener at 127.0.0.1:17091
    let modifiedBody = serverDataBody;
    modifiedBody = modifiedBody.replace(/^server\|.+$/m, "server|127.0.0.1");
    modifiedBody = modifiedBody.replace(/^port\|.+$/m, "port|17091");
    // Force type2|1 (direct ENet connection, bypass web login)
    if (/^type2\|/m.test(modifiedBody)) {
      modifiedBody = modifiedBody.replace(/^type2\|.+$/m, "type2|1");
    } else {
      modifiedBody += "\ntype2|1";
    }
    // Strip problematic lines
    modifiedBody = modifiedBody.replace(/^error\|.+$/gm, "");
    modifiedBody = modifiedBody.replace(/^url\|.+$/gm, "");
    modifiedBody = modifiedBody.replace(/^#maint\|.+$/gm, "");
    modifiedBody = modifiedBody.replace(/\n{2,}/g, "\n").trim();
    if (!modifiedBody.includes("RTENDMARKERBS1001")) {
      modifiedBody += "\nRTENDMARKERBS1001";
    }

    dim("Modified server_data for relay test:");
    for (const line of modifiedBody.split("\n")) {
      if (line.trim()) dim(line.length > 100 ? line.substring(0, 100) + "..." : line);
    }

    /**
     * Proxy a non-server_data request to the real GT server.
     * Routes to the correct IP based on the Host header.
     */
    function proxyToReal(req, res, body) {
      const reqHost = (req.headers.host || "").split(":")[0].toLowerCase();
      // Find the real endpoint IP for this hostname
      let ep = GT_ENDPOINTS[0]; // default
      for (const e of GT_ENDPOINTS) {
        if (e.host.toLowerCase() === reqHost) { ep = e; break; }
      }

      const proxyOpts = {
        hostname: ep.ip,
        port: 443,
        path: req.url,
        method: req.method || "GET",
        headers: { ...req.headers, host: ep.host },
        servername: ep.host,
        timeout: 8000,
        rejectUnauthorized: true,
      };
      // Remove hop-by-hop headers
      delete proxyOpts.headers["connection"];
      delete proxyOpts.headers["accept-encoding"];

      const proxyReq = https.request(proxyOpts, (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          if (res.destroyed) return;
          const respBody = Buffer.concat(chunks);
          ok(`[PROXY] ${req.method} ${req.url} → ${resp.statusCode} (${respBody.length}b)`);
          try {
            const headers = { ...resp.headers };
            headers["cache-control"] = "no-store";
            res.writeHead(resp.statusCode, headers);
            res.end(respBody);
          } catch {}
        });
      });

      proxyReq.on("error", (err) => {
        warn(`[PROXY] ${req.url} failed: ${err.message}`);
        if (!res.destroyed && !res.headersSent) {
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("Proxy error");
        }
      });

      proxyReq.on("timeout", () => {
        proxyReq.destroy();
        if (!res.destroyed && !res.headersSent) {
          res.writeHead(504, { "Content-Type": "text/plain" });
          res.end("Timeout");
        }
      });

      if (body) proxyReq.write(body);
      proxyReq.end();
    }

    // Handler: serve modified server_data for server_data.php,
    // proxy everything else to the real GT server.
    function handleRequest(req, res) {
      const isServerData = req.url && (
        req.url.includes("/growtopia/server_data.php") ||
        req.url.includes("server_data.php")
      );

      if (req.method === "POST" || req.method === "PUT") {
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
          size += c.length;
          if (size < 64 * 1024) chunks.push(c);
        });
        req.on("end", () => {
          if (res.destroyed) return;
          const body = Buffer.concat(chunks);
          if (isServerData) {
            ok(`[HTTPS] ${req.method} ${req.url} — serving modified server_data`);
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(modifiedBody);
          } else {
            ok(`[HTTPS] ${req.method} ${req.url} — proxying to real GT server`);
            proxyToReal(req, res, body);
          }
        });
        req.on("error", () => {
          if (!res.destroyed && !res.headersSent) {
            try { res.writeHead(200); res.end(modifiedBody); } catch {}
          }
        });
      } else {
        if (isServerData) {
          ok(`[HTTPS] ${req.method} ${req.url} — serving modified server_data`);
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(modifiedBody);
        } else {
          ok(`[HTTPS] ${req.method} ${req.url} — proxying to real GT server`);
          proxyToReal(req, res, null);
        }
      }
    }

    const servers = [];

    // HTTPS on 443
    try {
      const httpsServer = https.createServer(
        { key: EMBEDDED_KEY, cert: EMBEDDED_CERT },
        handleRequest
      );
      httpsServer.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          fail("[HTTPS] Port 443 is already in use!");
        } else {
          fail(`[HTTPS] Error: ${err.message}`);
        }
      });
      httpsServer.on("tlsClientError", () => {}); // suppress TLS handshake noise
      httpsServer.listen(443, "0.0.0.0", () => {
        ok("[HTTPS] Listening on port 443");
      });
      servers.push(httpsServer);
    } catch (err) {
      fail(`[HTTPS] Failed to create server: ${err.message}`);
    }

    // HTTP on 80 (GT tries this too)
    try {
      const httpServer = http.createServer(handleRequest);
      httpServer.on("error", () => {}); // silently ignore
      httpServer.listen(80, "0.0.0.0", () => {
        ok("[HTTP] Listening on port 80");
      });
      servers.push(httpServer);
    } catch {}

    // HTTP on 8080 (alternate)
    try {
      const http8080 = http.createServer(handleRequest);
      http8080.on("error", () => {});
      http8080.listen(8080, "0.0.0.0", () => {});
      servers.push(http8080);
    } catch {}

    // Give servers a moment to start
    setTimeout(() => {
      resolve({
        servers,
        close: () => {
          for (const s of servers) {
            try { s.close(); } catch {}
          }
        }
      });
    }, 500);
  });
}

/**
 * Find Growtopia executable on Windows.
 */
function findGrowtopia() {
  if (process.platform !== "win32") return null;
  const pathMod = require("path");
  const local = process.env.LOCALAPPDATA || "";
  const candidates = [
    pathMod.join(local, "Growtopia", "Growtopia.exe"),
    "C:\\Program Files\\Growtopia\\Growtopia.exe",
    "C:\\Program Files (x86)\\Growtopia\\Growtopia.exe",
    pathMod.join(require("os").homedir(), "Growtopia", "Growtopia.exe"),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

/**
 * Launch Growtopia and return the child process (or null).
 */
function launchGrowtopia() {
  const gamePath = findGrowtopia();
  if (!gamePath) {
    warn("Growtopia not found — please open it manually");
    return null;
  }
  ok(`Found Growtopia: ${gamePath}`);
  try {
    const { spawn } = require("child_process");
    const child = spawn(gamePath, [], {
      detached: true,
      stdio: "ignore",
      cwd: require("path").dirname(gamePath),
    });
    child.unref();
    child.on("error", () => {});
    ok("Growtopia launched automatically!");
    return child;
  } catch (err) {
    warn(`Failed to launch: ${err.message} — please open it manually`);
    return null;
  }
}

// Global cleanup state for signal handlers
let _relayCleanup = null;

async function relayTest(serverIP, serverPort, serverDataBody) {
  header("Step 6: RELAY TEST (full login + ENet relay)");
  info("This test does EXACTLY what the proxy does:");
  info("  1. Redirect GT domains to 127.0.0.1 (hosts file)");
  info("  2. Start HTTPS server on 443 to serve modified server_data");
  info("  3. Install our cert so GT trusts the HTTPS server");
  info("  4. Listen on UDP 17091 for the game's ENet packets");
  info("  5. Relay EXACT bytes to the real GT server");
  info("  6. Relay server responses back to the game");
  console.log();

  // Step A: Modify hosts
  if (!modifyHostsForRelay()) {
    warn("Skipping relay test (cannot modify hosts)");
    return { skipped: true };
  }
  ok("Hosts file modified");

  // Step B: Flush DNS
  if (process.platform === "win32") {
    try {
      require("child_process").execSync("ipconfig /flushdns", { stdio: "pipe" });
      ok("DNS cache flushed");
    } catch {}
  }

  // Step C: Install cert
  installCert();

  // Step D: Start HTTPS server
  const httpsServers = await startRelayHttpsServer(serverDataBody);
  info("HTTPS login server ready");

  // Step E: UDP sockets
  const listenSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const relaySocket = dgram.createSocket("udp4");

  let clientAddr = null;
  let clientPort = null;
  let serverResponded = false;
  let clientConnected = false;
  let clientPackets = 0;
  let serverPackets = 0;
  let gameProcess = null;

  // Register cleanup handler for Ctrl+C / unexpected exit
  _relayCleanup = () => {
    restoreHosts();
    removeCert();
    httpsServers.close();
    try { listenSocket.close(); } catch {}
    try { relaySocket.close(); } catch {}
    _relayCleanup = null;
  };

  return new Promise((resolve) => {
    listenSocket.on("message", (msg, rinfo) => {
      clientPackets++;

      if (!clientConnected) {
        clientConnected = true;
        clientAddr = rinfo.address;
        clientPort = rinfo.port;

        ok(`GT client ENet connected! ${rinfo.address}:${rinfo.port}`);
        ok(`Captured real ENet packet: ${msg.length} bytes`);
        dim(`Hex: ${hexDump(msg, 64)}`);

        // Analyze the packet
        if (msg.length >= 4) {
          const peerIDField = msg.readUInt16BE(0);
          const hasSentTime = !!(peerIDField & 0x8000);
          const isCompressed = !!(peerIDField & 0x4000);
          info(`peerID=0x${peerIDField.toString(16)} sentTime=${hasSentTime} compressed=${isCompressed}`);

          const crcOffset = 2 + (hasSentTime ? 2 : 0);
          if (crcOffset + 4 <= msg.length) {
            const storedCrc = msg.readUInt32LE(crcOffset);
            const testBuf = Buffer.from(msg);
            testBuf.writeUInt32LE(0, crcOffset);
            const computed = crc32(testBuf);
            if (storedCrc === computed) {
              ok(`CRC32 at offset ${crcOffset}: 0x${storedCrc.toString(16)} VALID`);
            } else {
              warn(`CRC32: stored=0x${storedCrc.toString(16)} computed=0x${computed.toString(16)}`);
            }
          }
        }

        info(`Relaying to real server ${serverIP}:${serverPort}...`);
      }

      // Relay EVERY client packet to the real server (unchanged)
      relaySocket.send(msg, 0, msg.length, serverPort, serverIP, (err) => {
        if (err) {
          fail(`Relay send failed: ${err.message}`);
        } else if (clientPackets <= 5) {
          try {
            const addr = relaySocket.address();
            ok(`Relayed ${msg.length}b to ${serverIP}:${serverPort} from :${addr.port} (pkt #${clientPackets})`);
          } catch {
            ok(`Relayed ${msg.length}b (pkt #${clientPackets})`);
          }
        }
      });
    });

    relaySocket.on("message", (msg, rinfo) => {
      serverPackets++;

      if (!serverResponded) {
        serverResponded = true;
        console.log();
        ok(`${GREEN}${BOLD}SERVER RESPONDED TO RELAYED PACKET!${RESET}`);
        ok(`Response: ${msg.length}b from ${rinfo.address}:${rinfo.port}`);
        dim(`Hex: ${hexDump(msg, 64)}`);
      }

      // Relay response back to game client
      if (clientAddr && clientPort) {
        listenSocket.send(msg, 0, msg.length, clientPort, clientAddr, () => {});
      }
    });

    listenSocket.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        fail("Port 17091 already in use! Close the proxy first.");
      } else {
        fail(`Listen error: ${err.message}`);
      }
      if (_relayCleanup) { _relayCleanup(); }
      resolve({ skipped: true });
    });

    relaySocket.on("error", (err) => {
      fail(`Relay socket error: ${err.message}`);
    });

    listenSocket.bind(17091, "0.0.0.0", () => {
      ok("UDP listening on port 17091");
      console.log();

      // Auto-launch Growtopia
      gameProcess = launchGrowtopia();
      if (!gameProcess) {
        info(`${BOLD}${YELLOW}>>> PLEASE OPEN GROWTOPIA MANUALLY <<<${RESET}`);
      }
      info("The game will get server_data from our HTTPS server,");
      info("then connect via ENet to port 17091. We relay to the real server.");
      info("Waiting 45 seconds...");
      console.log();
    });

    // 45 second timeout
    setTimeout(() => {
      if (_relayCleanup) { _relayCleanup(); }
      setTimeout(() => {
        resolve({
          skipped: false,
          clientConnected,
          serverResponded,
          clientPackets,
          serverPackets,
        });
      }, 2000);
    }, 45000);
  });
}

// ── Summary ──────────────────────────────────────────────────────────

function printSummary(loginResult, enetResult, relayResult) {
  header("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  header("              DIAGNOSTIC SUMMARY");
  header("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log();

  // Login
  if (loginResult) {
    ok(`Login: OK \u2014 server ${loginResult.ip}:${loginResult.port}`);
    if (loginResult.hasMaint) {
      warn("Maintenance flag: YES (but may not prevent connections)");
    }
  } else {
    fail("Login: FAILED \u2014 all GT servers unreachable");
  }

  // ENet crafted test
  if (enetResult && enetResult.anyResponded) {
    ok("ENet crafted CONNECT: Server responded");
  } else {
    warn("ENet crafted CONNECT: No response (GT uses custom format)");
  }

  // RELAY TEST — the important one
  if (relayResult && !relayResult.skipped) {
    if (!relayResult.clientConnected) {
      warn("Relay test: GT client did not connect (did you open Growtopia?)");
    } else if (relayResult.serverResponded) {
      console.log();
      ok(`${GREEN}${BOLD}VERDICT: UDP RELAY WORKS!${RESET}`);
      ok("Server responded to relayed packet.");
      info(`Client sent ${relayResult.clientPackets} packets, server sent ${relayResult.serverPackets} packets`);
      info("The relay mechanism works on this machine.");
      info("If the full proxy still fails, the issue is in session management or packet handling.");
    } else {
      console.log();
      fail(`${RED}${BOLD}VERDICT: RELAY FAILED \u2014 server did NOT respond to relayed packets.${RESET}`);
      info(`Client sent ${relayResult.clientPackets} packets \u2192 all relayed \u2192 0 responses.`);
      info("Your GT client sent real ENet packets, we forwarded the EXACT bytes,");
      info("but the GT server ignored them.");
      console.log();
      info("This is the SAME thing the proxy does. The problem is NOT the proxy code.");
      info("Possible causes:");
      info("  1. Windows Firewall blocks INBOUND UDP responses to this process");
      info("  2. The GT server validates the source IP/port in some way");
      info("  3. Your router/NAT has UPnP rules that only map the real GT client");
      info("  4. Anti-cheat / anti-tamper in the game detects the relay");
      info("  5. The server IP in server_data is a relay/CDN that pins the source");
    }
  } else if (relayResult && relayResult.skipped) {
    warn("Relay test: Skipped");
  }

  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`${BOLD}${CYAN}`);
  console.log("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
  console.log("\u2551   dqymon-diagnose v2 \u2014 GT Connection Test     \u2551");
  console.log("\u2551   Tests login + ENet + RELAY (run as admin)   \u2551");
  console.log("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
  console.log(RESET);

  info(`Time: ${new Date().toLocaleString()}`);
  info(`Platform: ${process.platform} ${process.arch}`);

  // Step 1
  checkHostsFile();

  // Step 2
  await checkDns();

  // Step 3+4
  const loginResult = await testLogin();
  if (!loginResult) {
    fail("Cannot proceed without server info.");
    printSummary(null, null, null);
    await pause();
    return;
  }

  // Step 5: Crafted ENet test
  const enetResult = await testENetConnection(loginResult.ip, loginResult.port);

  // Step 6: RELAY TEST
  console.log();
  const doRelay = await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      `\n${BOLD}Run the RELAY TEST? This will temporarily modify your hosts file. (Y/n): ${RESET}`,
      (answer) => {
        rl.close();
        resolve(!answer || answer.toLowerCase() !== "n");
      }
    );
  });

  let relayResult = null;
  if (doRelay) {
    relayResult = await relayTest(loginResult.ip, loginResult.port, loginResult.rawBody);
  } else {
    info("Relay test skipped.");
    relayResult = { skipped: true };
  }

  printSummary(loginResult, enetResult, relayResult);
  await pause();
}

main().catch(async (err) => {
  if (_relayCleanup) { _relayCleanup(); }
  restoreHosts();
  removeCert();
  console.error(`\n${RED}[FATAL] ${err.message}${RESET}\n${err.stack}`);
  await pause();
  process.exit(1);
});

// Ensure cleanup on unexpected exit
process.on("SIGINT", () => {
  if (_relayCleanup) { _relayCleanup(); }
  restoreHosts();
  removeCert();
  process.exit();
});
process.on("SIGTERM", () => {
  if (_relayCleanup) { _relayCleanup(); }
  restoreHosts();
  removeCert();
  process.exit();
});
