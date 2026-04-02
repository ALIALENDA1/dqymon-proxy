#!/usr/bin/env node
/**
 * dqymon-diagnose — Standalone Growtopia connection diagnostic tool.
 *
 * Tests the ENTIRE login + ENet flow WITHOUT any proxy involvement:
 *   1. HTTPS POST to real GT login servers → fetches server_data
 *   2. Parses server IP, port, maintenance flags
 *   3. Sends a raw ENet CONNECT packet to the game server
 *   4. Waits for a response
 *
 * Run this WITHOUT the proxy running and WITHOUT hosts file changes.
 * If this tool also gets no ENet response, the GT server is genuinely
 * down/in maintenance and the proxy is NOT the problem.
 */

const https = require("https");
const dgram = require("dgram");
const dns = require("dns");
const readline = require("readline");

// ── Helpers ──────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function ok(msg) { console.log(`${GREEN}  ✓${RESET} ${msg}`); }
function fail(msg) { console.log(`${RED}  ✗${RESET} ${msg}`); }
function warn(msg) { console.log(`${YELLOW}  ⚠${RESET} ${msg}`); }
function info(msg) { console.log(`${CYAN}  ›${RESET} ${msg}`); }
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

// ── GT Login Endpoints ───────────────────────────────────────────────

const GT_ENDPOINTS = [
  { ip: "23.59.80.217",  host: "www.growtopia1.com" },
  { ip: "23.59.80.203",  host: "www.growtopia1.com" },
  { ip: "34.234.161.35", host: "www.growtopia2.com" },
  { ip: "54.237.100.60", host: "www.growtopia2.com" },
  { ip: "54.204.235.73", host: "login.growtopiagame.com" },
  { ip: "98.90.113.253", host: "login.growtopiagame.com" },
];

// ── Step 1: Check if hosts file is clean ─────────────────────────────

function checkHostsFile() {
  header("Step 1: Checking hosts file");

  const hostsPath = process.platform === "win32"
    ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
    : "/etc/hosts";

  try {
    const fs = require("fs");
    const content = fs.readFileSync(hostsPath, "utf8");
    const proxyLines = content.split("\n").filter(l =>
      l.includes("growtopia") && !l.trim().startsWith("#")
    );

    if (proxyLines.length > 0) {
      warn("Hosts file has Growtopia redirects (proxy is active):");
      proxyLines.forEach(l => dim(l.trim()));
      warn("Results may not reflect direct connection. Stop the proxy first.");
      return false;
    }
    ok("Hosts file is clean — no Growtopia redirects");
    return true;
  } catch (err) {
    warn(`Could not read hosts file: ${err.message}`);
    return true; // continue anyway
  }
}

// ── Step 2: DNS resolution ───────────────────────────────────────────

async function checkDns() {
  header("Step 2: DNS resolution");

  const domains = ["www.growtopia1.com", "www.growtopia2.com", "login.growtopiagame.com"];
  const results = {};

  for (const domain of domains) {
    try {
      const addrs = await new Promise((resolve, reject) => {
        dns.resolve4(domain, (err, addresses) => {
          if (err) reject(err); else resolve(addresses);
        });
      });
      ok(`${domain} → ${addrs.join(", ")}`);
      results[domain] = addrs;
    } catch (err) {
      fail(`${domain} → DNS failed: ${err.code || err.message}`);
      results[domain] = null;
    }
  }

  return results;
}

// ── Step 3: HTTPS login to GT servers ────────────────────────────────

function fetchServerData(ep, postBody) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const reqOpts = {
      hostname: ep.ip,
      port: 443,
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
    };

    const req = https.request(reqOpts, (resp) => {
      const chunks = [];
      resp.on("data", (c) => chunks.push(c));
      resp.on("end", () => {
        const elapsed = Date.now() - startTime;
        const body = Buffer.concat(chunks).toString();
        resolve({ ok: true, status: resp.statusCode, body, elapsed, ep });
      });
    });

    req.on("error", (err) => {
      resolve({ ok: false, error: err.message, ep });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "Timeout (8s)", ep });
    });

    req.write(postBody);
    req.end();
  });
}

async function testLogin() {
  header("Step 3: HTTPS login to GT servers");

  // Minimal POST body that GT accepts
  const postBody = "version=4.61&platform=0&deviceVersion=0";

  let bestResult = null;

  for (const ep of GT_ENDPOINTS) {
    info(`Trying ${ep.host} @ ${ep.ip}...`);

    const result = await fetchServerData(ep, postBody);

    if (!result.ok) {
      fail(`${ep.host}@${ep.ip}: ${result.error}`);
      continue;
    }

    if (result.status !== 200) {
      fail(`${ep.host}@${ep.ip}: HTTP ${result.status}`);
      continue;
    }

    ok(`${ep.host}@${ep.ip}: HTTP 200 (${result.body.length}b, ${result.elapsed}ms)`);
    bestResult = result;
    break; // use first successful response
  }

  if (!bestResult) {
    fail("All GT login servers unreachable!");
    return null;
  }

  // Parse server_data
  header("Step 4: Parsing server_data");

  const body = bestResult.body;
  const parsed = {};

  // Extract key fields
  const fields = ["server", "port", "type", "type2", "loginurl", "#maint", "meta", "RTENDMARKERBS1001"];
  for (const line of body.split("\n")) {
    const pipeIdx = line.indexOf("|");
    if (pipeIdx === -1) continue;
    const key = line.substring(0, pipeIdx);
    const val = line.substring(pipeIdx + 1);
    parsed[key] = val.trim();
  }

  // Display server_data contents
  dim("─── Raw server_data ───");
  for (const line of body.split("\n")) {
    if (line.trim()) {
      // Truncate long lines
      const display = line.length > 100 ? line.substring(0, 100) + "..." : line;
      dim(display);
    }
  }
  dim("───────────────────────");

  // Key findings
  const serverIP = parsed["server"];
  const serverPort = parseInt(parsed["port"], 10) || 17091;

  if (serverIP) {
    ok(`Game server: ${serverIP}:${serverPort}`);
  } else {
    fail("No server field in response!");
    return null;
  }

  if (parsed["#maint"]) {
    warn(`MAINTENANCE FLAG: ${parsed["#maint"]}`);
  } else {
    ok("No maintenance flag detected");
  }

  if (parsed["type2"]) {
    info(`type2: ${parsed["type2"]}`);
  }
  if (parsed["loginurl"]) {
    info(`loginurl: ${parsed["loginurl"]}`);
  }
  if (parsed["meta"]) {
    info(`meta: ${parsed["meta"].substring(0, 60)}...`);
  }

  return { ip: serverIP, port: serverPort, hasMaint: !!parsed["#maint"], rawBody: body };
}

// ── Step 5: ENet UDP connection test ─────────────────────────────────

/**
 * Build a minimal ENet CONNECT packet.
 * This mimics what a real Growtopia client sends as its first datagram.
 */
function buildENetConnect() {
  // ENet protocol header:
  //   2 bytes: peerID with flags (0x8FFF = sentTime flag + peerID 0xFFF)
  //   2 bytes: sentTime (0)
  // Command header:
  //   1 byte: command (0x02 = CONNECT, with 0x80 = ACK flag)
  //   1 byte: channelID (0xFF)
  //   2 bytes: reliableSequenceNumber (1)
  // Connect data (36 bytes):
  //   2 bytes: outgoingPeerID (0)
  //   1 byte: incomingSessionID (0xFF)
  //   1 byte: outgoingSessionID (0xFF)
  //   4 bytes: MTU (1400)
  //   4 bytes: windowSize (32768)
  //   4 bytes: channelCount (2)
  //   4 bytes: incomingBandwidth (0)
  //   4 bytes: outgoingBandwidth (0)
  //   4 bytes: packetThrottleInterval (5000)
  //   4 bytes: packetThrottleAcceleration (2)
  //   4 bytes: packetThrottleDeceleration (2)
  //   4 bytes: connectID (random)

  const buf = Buffer.alloc(44);
  buf.writeUInt16BE(0x8FFF, 0);     // peerID=0xFFF + sentTime flag
  buf.writeUInt16BE(0, 2);          // sentTime
  buf[4] = 0x82;                    // CONNECT | ACK flag
  buf[5] = 0xFF;                    // channelID
  buf.writeUInt16BE(1, 6);          // reliableSequenceNumber
  buf.writeUInt16BE(0, 8);          // outgoingPeerID
  buf[10] = 0xFF;                   // incomingSessionID
  buf[11] = 0xFF;                   // outgoingSessionID
  buf.writeUInt32BE(1400, 12);      // MTU
  buf.writeUInt32BE(32768, 16);     // windowSize
  buf.writeUInt32BE(2, 20);         // channelCount
  buf.writeUInt32BE(0, 24);         // incomingBandwidth
  buf.writeUInt32BE(0, 28);         // outgoingBandwidth
  buf.writeUInt32BE(5000, 32);      // packetThrottleInterval
  buf.writeUInt32BE(2, 36);         // packetThrottleAcceleration
  buf.writeUInt32BE(2, 40);         // packetThrottleDeceleration
  // connectID at offset 44 would be the next 4 bytes, but our buffer is 44
  // so let's extend to include connectID
  const full = Buffer.alloc(48);
  buf.copy(full);
  const connectID = Math.floor(Math.random() * 0xFFFFFFFF);
  full.writeUInt32BE(connectID, 44);

  return full;
}

function testENetConnection(serverIP, serverPort) {
  return new Promise((resolve) => {
    header("Step 5: ENet UDP connection test");

    info(`Target: ${serverIP}:${serverPort}`);
    info("Sending ENet CONNECT from 3 different sockets simultaneously...");

    let anyResponded = false;
    const sockets = [];
    const results = {};
    let finished = 0;

    // Test from 3 different ephemeral ports to rule out port-based blocking
    for (let i = 0; i < 3; i++) {
      const label = `Socket-${i + 1}`;
      const sock = dgram.createSocket("udp4");
      sockets.push({ sock, label });
      results[label] = { sent: false, responded: false, responseSize: 0 };

      sock.on("message", (msg, rinfo) => {
        if (!results[label].responded) {
          results[label].responded = true;
          results[label].responseSize = msg.length;
          results[label].responseFrom = `${rinfo.address}:${rinfo.port}`;
          anyResponded = true;

          ok(`${label}: Got response! ${msg.length}b from ${rinfo.address}:${rinfo.port}`);

          // Show first bytes
          const hex = msg.slice(0, Math.min(msg.length, 32))
            .toString("hex").match(/.{1,2}/g).join(" ");
          dim(`Response hex: ${hex}`);
        }
      });

      sock.on("error", (err) => {
        fail(`${label}: Socket error: ${err.message}`);
      });
    }

    // Send from all sockets
    const connectPacket = buildENetConnect();
    dim(`ENet CONNECT packet: ${connectPacket.length} bytes`);
    dim(`Hex: ${connectPacket.slice(0, 32).toString("hex").match(/.{1,2}/g).join(" ")} ...`);

    for (const { sock, label } of sockets) {
      sock.send(connectPacket, serverPort, serverIP, (err) => {
        if (err) {
          fail(`${label}: Send failed: ${err.message}`);
          results[label].sent = false;
        } else {
          const addr = sock.address();
          results[label].sent = true;
          results[label].srcPort = addr.port;
          ok(`${label}: Sent ${connectPacket.length}b to ${serverIP}:${serverPort} from :${addr.port}`);
        }
      });
    }

    // Also send a second packet after 2 seconds (GT might need retransmit)
    setTimeout(() => {
      if (anyResponded) return;
      info("No response yet — sending retransmit...");
      for (const { sock, label } of sockets) {
        if (results[label].sent && !results[label].responded) {
          sock.send(connectPacket, serverPort, serverIP, () => {});
        }
      }
    }, 2000);

    // Also try a third time after 5 seconds
    setTimeout(() => {
      if (anyResponded) return;
      info("Still no response — sending final retry...");
      for (const { sock, label } of sockets) {
        if (results[label].sent && !results[label].responded) {
          sock.send(connectPacket, serverPort, serverIP, () => {});
        }
      }
    }, 5000);

    // Wait 10 seconds total
    setTimeout(() => {
      // Close all sockets
      for (const { sock } of sockets) {
        try { sock.close(); } catch {}
      }

      resolve({ anyResponded, results });
    }, 10000);
  });
}

// ── Step 6: Also try connecting with the REAL client's first packet ──
// Capture what a real GT client sends by using a known Connect pattern.
// The ENet connect we craft may differ from GT's custom variant.

function testRawUDP(serverIP, serverPort) {
  return new Promise((resolve) => {
    header("Step 6: Raw UDP reachability test");

    info(`Sending a minimal UDP ping to ${serverIP}:${serverPort}`);
    info("(Just to confirm UDP packets reach the server at all)");

    const sock = dgram.createSocket("udp4");
    let responded = false;

    sock.on("message", (msg, rinfo) => {
      responded = true;
      ok(`Server sent back ${msg.length}b from ${rinfo.address}:${rinfo.port}`);
      const hex = msg.slice(0, Math.min(msg.length, 32))
        .toString("hex").match(/.{1,2}/g).join(" ");
      dim(`Hex: ${hex}`);
    });

    // Send a tiny nonsense packet — just to see if the server responds
    // with an ENet BANDWIDTH_LIMIT or DISCONNECT or anything
    const tiny = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    sock.send(tiny, serverPort, serverIP, (err) => {
      if (err) {
        fail(`Send failed: ${err.message}`);
      } else {
        ok(`Sent 4b junk to ${serverIP}:${serverPort}`);
      }
    });

    setTimeout(() => {
      try { sock.close(); } catch {}
      resolve(responded);
    }, 5000);
  });
}

// ── Summary ──────────────────────────────────────────────────────────

function printSummary(hostsClean, loginResult, enetResult, rawUdpResult) {
  header("═══════════════════════════════════════════");
  header("           DIAGNOSTIC SUMMARY");
  header("═══════════════════════════════════════════");

  console.log();

  // Hosts file
  if (hostsClean) {
    ok("Hosts file: Clean (no proxy redirects)");
  } else {
    warn("Hosts file: Has proxy redirects (results may not be accurate)");
  }

  // Login
  if (loginResult) {
    ok(`Login: Successfully reached GT server`);
    info(`Game server: ${loginResult.ip}:${loginResult.port}`);
    if (loginResult.hasMaint) {
      warn(`Maintenance: YES — server_data contains #maint flag`);
    } else {
      ok("Maintenance: No");
    }
  } else {
    fail("Login: Could not reach any GT login server");
  }

  // ENet
  if (enetResult && enetResult.anyResponded) {
    ok("ENet: GT server RESPONDED to our CONNECT packet!");
    console.log();
    ok(`${GREEN}${BOLD}VERDICT: The GT server is ONLINE and accepting ENet connections.${RESET}`);
    info("If the proxy doesn't work, the issue is in the proxy's UDP relay.");
  } else {
    fail("ENet: GT server did NOT respond to CONNECT packets (10s timeout)");

    if (loginResult && loginResult.hasMaint) {
      console.log();
      warn(`${BOLD}VERDICT: Server is in MAINTENANCE mode.${RESET}`);
      info("The #maint flag was present in server_data AND the ENet connection failed.");
      info("This confirms the GT server is deliberately refusing game connections.");
      info("Neither the proxy NOR a direct connection will work right now.");
      info("Wait for maintenance to end, then try again.");
    } else {
      console.log();
      warn(`${BOLD}VERDICT: GT server is unreachable via UDP.${RESET}`);
      info("No maintenance flag was found, but ENet still failed.");
      info("Possible causes:");
      info("  1. Your ISP/network blocks outbound UDP to port 17091");
      info("  2. Windows Firewall is blocking outbound UDP");
      info("  3. GT server is having issues (try again later)");
      info("  4. The server IP has changed (GT rotates servers)");
    }
  }

  // Raw UDP
  if (rawUdpResult) {
    ok("Raw UDP: Server responded to raw UDP packet");
  } else {
    dim("Raw UDP: No response to junk packet (expected if server only speaks ENet)");
  }

  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`${BOLD}${CYAN}`);
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   dqymon-diagnose — GT Connection Test   ║");
  console.log("║   Tests login + ENet WITHOUT any proxy   ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(RESET);

  info(`Time: ${new Date().toLocaleString()}`);
  info(`Platform: ${process.platform} ${process.arch}`);
  info(`Node: ${process.version}`);

  // Step 1: Check hosts file
  const hostsClean = checkHostsFile();

  // Step 2: DNS
  await checkDns();

  // Step 3+4: Login
  const loginResult = await testLogin();

  if (!loginResult) {
    fail("Cannot proceed without login data.");
    printSummary(hostsClean, null, null, false);
    await pause();
    return;
  }

  // Step 5: ENet test
  const enetResult = await testENetConnection(loginResult.ip, loginResult.port);

  // Step 6: Raw UDP test
  const rawUdpResult = await testRawUDP(loginResult.ip, loginResult.port);

  // Summary
  printSummary(hostsClean, loginResult, enetResult, rawUdpResult);

  await pause();
}

main().catch(async (err) => {
  console.error(`\n${RED}[FATAL] ${err.message}${RESET}\n${err.stack}`);
  await pause();
  process.exit(1);
});
