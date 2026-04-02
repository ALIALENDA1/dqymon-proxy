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
//   - Listen on port 17091
//   - Redirect GT domains to 127.0.0.1 via hosts file
//   - Wait for the real GT client to send its first ENet packet
//   - Relay that EXACT packet to the real server from a DIFFERENT socket
//   - See if we get a response
//
// If this works -> the proxy's relay mechanism CAN work
// If this fails -> something on this machine prevents UDP relay

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

function relayTest(serverIP, serverPort) {
  return new Promise((resolve) => {
    header("Step 6: RELAY TEST (captures + relays your real GT client's packet)");
    info("This test will:");
    info("  1. Temporarily redirect GT domains to 127.0.0.1");
    info("  2. Listen on port 17091 (like the proxy does)");
    info("  3. Wait for you to open Growtopia (30 seconds)");
    info("  4. Capture the REAL ENet packet your client sends");
    info("  5. Relay the EXACT bytes to the GT server from another socket");
    info("  6. Check if the server responds");
    console.log();

    // Modify hosts
    if (!modifyHostsForRelay()) {
      warn("Skipping relay test (cannot modify hosts)");
      resolve({ skipped: true });
      return;
    }
    ok("Hosts file modified \u2014 GT domains \u2192 127.0.0.1");

    // Flush DNS on Windows
    if (process.platform === "win32") {
      try {
        require("child_process").execSync("ipconfig /flushdns", { stdio: "pipe" });
        ok("DNS cache flushed");
      } catch {}
    }

    // Socket 1: Listen for GT client on port 17091
    const listenSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    // Socket 2: Relay to server from ephemeral port (exactly like the proxy)
    const relaySocket = dgram.createSocket("udp4");

    let clientAddr = null;
    let clientPort = null;
    let serverResponded = false;
    let clientConnected = false;
    let clientPackets = 0;
    let serverPackets = 0;

    listenSocket.on("message", (msg, rinfo) => {
      clientPackets++;

      if (!clientConnected) {
        clientConnected = true;
        clientAddr = rinfo.address;
        clientPort = rinfo.port;

        ok(`GT client connected! ${rinfo.address}:${rinfo.port}`);
        ok(`Captured real ENet packet: ${msg.length} bytes`);
        dim(`Hex: ${hexDump(msg, 64)}`);

        // Verify CRC32 on client's packet to understand its format
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
            ok(`CRC32 at offset ${crcOffset}: 0x${storedCrc.toString(16)} \u2713 VALID`);
          } else {
            warn(`CRC32 at offset ${crcOffset}: stored=0x${storedCrc.toString(16)} computed=0x${computed.toString(16)} (mismatch)`);
            info("GT might use a different checksum algorithm or no checksum.");
          }
        }

        info(`Relaying to real server ${serverIP}:${serverPort}...`);
      }

      // Relay EVERY client packet to the server (unchanged!)
      relaySocket.send(msg, 0, msg.length, serverPort, serverIP, (err) => {
        if (err) {
          fail(`Relay to server failed: ${err.message}`);
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
        ok(`${GREEN}${BOLD}\u2713\u2713\u2713 GT SERVER RESPONDED TO RELAYED PACKET! \u2713\u2713\u2713${RESET}`);
        ok(`Response: ${msg.length}b from ${rinfo.address}:${rinfo.port}`);
        dim(`Hex: ${hexDump(msg, 64)}`);
      }

      // Relay server response back to client
      if (clientAddr && clientPort) {
        listenSocket.send(msg, 0, msg.length, clientPort, clientAddr, () => {});
      }
    });

    listenSocket.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        fail("Port 17091 is already in use! Close the proxy first.");
      } else {
        fail(`Listen socket error: ${err.message}`);
      }
      restoreHosts();
      resolve({ skipped: true });
    });

    relaySocket.on("error", (err) => {
      fail(`Relay socket error: ${err.message}`);
    });

    listenSocket.bind(17091, "0.0.0.0", () => {
      ok("Listening on port 17091");
      console.log();
      info(`${BOLD}${YELLOW}>>> NOW OPEN GROWTOPIA and wait for it to connect <<<${RESET}`);
      info("You have 30 seconds...");
      console.log();
    });

    // 30 second timeout
    const timeout = setTimeout(() => {
      restoreHosts();
      // Give a couple more seconds for any trailing responses
      setTimeout(() => {
        try { listenSocket.close(); } catch {}
        try { relaySocket.close(); } catch {}
        resolve({
          skipped: false,
          clientConnected,
          serverResponded,
          clientPackets,
          serverPackets,
        });
      }, 2000);
    }, 30000);

    // If we do get a server response, extend the relay for 10 more seconds
    // so the user can actually see the game connect
    relaySocket.on("message", () => {
      // first response already handled above
    });
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
    relayResult = await relayTest(loginResult.ip, loginResult.port);
  } else {
    info("Relay test skipped.");
    relayResult = { skipped: true };
  }

  printSummary(loginResult, enetResult, relayResult);
  await pause();
}

main().catch(async (err) => {
  restoreHosts();
  console.error(`\n${RED}[FATAL] ${err.message}${RESET}\n${err.stack}`);
  await pause();
  process.exit(1);
});
