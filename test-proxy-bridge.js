#!/usr/bin/env node
/**
 * Proof-of-concept: growtopia.js ENet proxy bridge
 * 
 * Architecture:
 *   GT Client ↔ [ENet Server :17091] ↔ proxy ↔ [ENet Client :17092] ↔ GT Server
 * 
 * Both sides use growtopia.js which understands GT's custom ENet protocol.
 * Uses raw Host API with a single manual service loop to avoid Rust panics.
 */

const { Host, Peer: PeerClass, Client } = require("growtopia.js");

const GT_SERVER = "213.179.209.175";
const GT_PORT = 17046;
const LOCAL_PORT = 17091;

console.log("=== growtopia.js Proxy Bridge PoC ===");
console.log(`Local: 0.0.0.0:${LOCAL_PORT}`);
console.log(`Remote: ${GT_SERVER}:${GT_PORT}`);
console.log("");

// ── Create two separate hosts ──
// Server host: accepts GT client connections (acts as GT server)
const serverHost = new Host(
  "0.0.0.0",   // ip
  LOCAL_PORT,   // port (17091)
  32,           // maxPeers
  2,            // channelLimit
  false,        // useNewPacket.asClient (we're the server)
  true,         // useNewServerPacket
  null, null,   // bandwidth limits
  null,         // compressor
  null,         // checksum
  null          // seed
);

// Client host: connects to real GT server (acts as GT client)
const clientHost = new Host(
  "0.0.0.0",   // ip
  LOCAL_PORT + 1, // port (17092)
  2,            // maxPeers
  2,            // channelLimit
  true,         // useNewPacket.asClient (we're the client)
  false,        // useNewServerPacket
  null, null,   // bandwidth limits
  null,         // compressor
  null,         // checksum
  null          // seed
);

let clientNetID = null;     // GT client's netID on the server host
let serverPeerNetID = null; // Our connection's netID on the client host
let serverConnecting = false;
let clientToServer = 0;
let serverToClient = 0;

// ── Event routing ──

function onServerEvent(type, netID, channelID, data) {
  switch (type) {
    case "connect": {
      clientNetID = netID;
      console.log(`\n✓ GT Client connected! netID=${netID}`);
      
      if (!serverPeerNetID && !serverConnecting) {
        console.log("  → Connecting to real GT server...");
        serverConnecting = true;
        clientHost.connect(GT_SERVER, GT_PORT);
      }
      break;
    }
    
    case "disconnect": {
      console.log(`\nGT Client disconnected: netID=${netID}`);
      clientNetID = null;
      break;
    }
    
    case "raw": {
      clientToServer++;
      
      if (clientToServer <= 10 || clientToServer % 50 === 0) {
        const msgType = data.length >= 4 ? data.readUInt32LE(0) : -1;
        console.log(`  C→S: ${data.length}b ch=${channelID} type=${msgType} (pkt #${clientToServer})`);
        
        if ((msgType === 2 || msgType === 3) && data.length > 4) {
          const text = data.slice(4).toString("utf8").replace(/\0+$/, "");
          const redacted = text.replace(/(tankid_password_hash|klv|hash|hash2|rid|mac|wk|zf|fhash)\|[^\n]+/g, "$1|[REDACTED]");
          console.log(`       Text: ${redacted.substring(0, 300)}`);
        }
      }
      
      // Forward to GT server
      if (serverPeerNetID !== null) {
        try {
          clientHost.send(serverPeerNetID, data, channelID);
        } catch (err) {
          console.error(`  ✗ C→S forward failed: ${err.message}`);
        }
      }
      break;
    }
  }
}

function onClientEvent(type, netID, channelID, data) {
  switch (type) {
    case "connect": {
      serverPeerNetID = netID;
      serverConnecting = false;
      console.log(`\n✓ Connected to GT server! netID=${netID}`);
      console.log("  → Bridge is ACTIVE — packets will flow both ways!\n");
      break;
    }
    
    case "disconnect": {
      console.log(`\nGT Server disconnected: netID=${netID}`);
      serverPeerNetID = null;
      serverConnecting = false;
      break;
    }
    
    case "raw": {
      serverToClient++;
      
      if (serverToClient <= 10 || serverToClient % 50 === 0) {
        const msgType = data.length >= 4 ? data.readUInt32LE(0) : -1;
        console.log(`  S→C: ${data.length}b ch=${channelID} type=${msgType} (pkt #${serverToClient})`);
        
        if ((msgType === 2 || msgType === 3) && data.length > 4) {
          const text = data.slice(4).toString("utf8").replace(/\0+$/, "");
          console.log(`       Text: ${text.substring(0, 300)}`);
        }
      }
      
      // Forward to GT client
      if (clientNetID !== null) {
        try {
          serverHost.send(clientNetID, data, channelID);
        } catch (err) {
          console.error(`  ✗ S→C forward failed: ${err.message}`);
        }
      }
      break;
    }
  }
}

// ── Set emitters ──
serverHost.setEmitter((type, netID, channelID, data) => {
  onServerEvent(type, netID, channelID, data);
});

clientHost.setEmitter((type, netID, channelID, data) => {
  onClientEvent(type, netID, channelID, data);
});

// ── Single manual service loop ──
// Service both hosts from one loop to avoid Rust thread conflicts
function serviceLoop() {
  try {
    serverHost.service();
  } catch (err) {
    // Ignore service errors during startup
  }
  try {
    clientHost.service();
  } catch (err) {
    // Ignore
  }
  setImmediate(serviceLoop);
}

console.log(`✓ Server listening on port ${LOCAL_PORT}`);
console.log(`✓ Client host ready on port ${LOCAL_PORT + 1}`);
console.log("\nWaiting for GT client to connect to port 17091...");
console.log("(Make sure hosts file redirects GT domains to 127.0.0.1)\n");

serviceLoop();

// Stats
setInterval(() => {
  if (clientNetID !== null || serverPeerNetID !== null) {
    console.log(`  [STATS] C→S: ${clientToServer} | S→C: ${serverToClient} | client=${clientNetID !== null} server=${serverPeerNetID !== null}`);
  }
}, 10000);

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  process.exit(0);
});
