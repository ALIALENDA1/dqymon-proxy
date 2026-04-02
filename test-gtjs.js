#!/usr/bin/env node
/**
 * Test: Can growtopia.js (GT-specific ENet) connect to the real GT server?
 * 
 * growtopia.js is a Rust-based ENet framework specifically built for Growtopia.
 * It handles GT's custom ENet modifications internally.
 * 
 * If this connects -> we can build a proper proxy with it
 */

const { Client, TextPacket, Peer } = require("growtopia.js");

const GT_SERVER = "213.179.209.175";
const GT_PORT = 17046;

console.log("=== growtopia.js ENet Test ===");
console.log(`Target: ${GT_SERVER}:${GT_PORT}`);

// Create GT client on an ephemeral port (not 17091 to avoid conflicts)
const client = new Client({
  enet: {
    ip: "0.0.0.0",
    port: 17999,       // our local port
    maxPeers: 2,
    channelLimit: 2,
    useNewPacket: {
      asClient: true   // GT client mode
    },
    useNewServerPacket: false,
  }
});

let connected = false;
let gotData = false;

client.on("ready", () => {
  console.log("✓ ENet host ready on port 17999");
  console.log(`  Connecting to ${GT_SERVER}:${GT_PORT}...`);
  
  try {
    client.connect(GT_SERVER, GT_PORT);
    console.log("✓ Connection initiated");
  } catch (err) {
    console.log("✗ Connect failed:", err.message);
    process.exit(1);
  }
});

client.on("connect", (netID) => {
  connected = true;
  console.log(`\n✓✓✓ CONNECTED! netID=${netID}`);
  console.log("  GT server accepted growtopia.js ENet handshake!");
  console.log("  A proper ENet proxy IS possible with growtopia.js!");
  
  // The server should send a Hello (type 1) packet
  // We can wait for it in the 'raw' event
});

client.on("disconnect", (netID) => {
  console.log(`\n✗ Disconnected: netID=${netID}`);
  if (!connected) {
    console.log("  Server rejected or timeout");
  }
});

client.on("raw", (netID, channelID, data) => {
  gotData = true;
  console.log(`\n✓ Received data: netID=${netID} ch=${channelID} len=${data.length}`);
  console.log(`  Hex (first 64b): ${data.slice(0, 64).toString("hex")}`);
  
  if (data.length >= 4) {
    const msgType = data.readUInt32LE(0);
    console.log(`  GT message type: ${msgType}`);
    switch (msgType) {
      case 1: console.log("  → HELLO (server hello)"); break;
      case 2: console.log("  → LOGIN_INFO (text key|value)"); break;
      case 3: console.log("  → ACTION"); break;
      case 4: console.log("  → TANK (binary game data)"); break;
      default: console.log("  → Unknown type"); break;
    }
    
    if (msgType === 2 || msgType === 3) {
      const text = data.slice(4).toString("utf8").replace(/\0+$/, "");
      console.log(`  Text: ${text.substring(0, 200)}`);
    }
  }
});

client.on("error", (err) => {
  console.error("Error:", err.message || err);
});

// Start the event loop
client.listen();

// Timeout after 15 seconds
setTimeout(() => {
  if (!connected) {
    console.log("\n✗ No connection after 15s");
    console.log("  growtopia.js could not connect to the GT server.");
    console.log("  The server may require additional authentication or the");
    console.log("  GT client version in growtopia.js may be outdated.");
  } else if (!gotData) {
    console.log("\n⚠ Connected but no data received after 15s");
  } else {
    console.log("\n✓ Test complete — connection and data exchange work!");
  }
  process.exit(connected ? 0 : 1);
}, 15000);
