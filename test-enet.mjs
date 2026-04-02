#!/usr/bin/env node
/**
 * Quick test: Can stock ENet library connect to the GT server?
 * 
 * This tests whether GT uses standard ENet at the transport layer
 * (even if the application protocol inside is custom).
 * 
 * If stock ENet connects -> we can build a proper ENet proxy
 * If stock ENet fails    -> GT uses custom ENet, need different approach
 */

// Set the library path BEFORE importing enet-js
process.env.ENET_LIB_PATH = "/usr/lib/x86_64-linux-gnu/libenet.so.7";

import { enet, ENetEventType, ENetPacketFlag, ENET_HOST_ANY } from "enet-js";

const GT_SERVER = "213.179.209.175";
const GT_PORT = 17046; // from latest server_data

console.log("=== ENet Library Test ===");
console.log(`Target: ${GT_SERVER}:${GT_PORT}`);

// Initialize ENet
if (enet.initialize() !== 0) {
  console.error("Failed to initialize ENet");
  process.exit(1);
}
console.log("✓ ENet initialized");

// Create client host (no address = client mode)
const client = enet.host.create(
  null,    // no address = client
  1,       // max 1 outgoing connection
  2,       // 2 channels (GT uses 2)
  0,       // any incoming bandwidth
  0        // any outgoing bandwidth
);

if (!client) {
  console.error("✗ Failed to create ENet client host");
  enet.deinitialize();
  process.exit(1);
}
console.log("✓ ENet client host created");

// Connect to GT server
const address = { host: GT_SERVER, port: GT_PORT };
const peer = enet.host.connect(client, address, 2, 0);

if (!peer) {
  console.error("✗ Failed to initiate connection");
  enet.host.destroy(client);
  enet.deinitialize();
  process.exit(1);
}
console.log(`✓ Connecting to ${GT_SERVER}:${GT_PORT}...`);

// Poll for events (10 seconds max)
let connected = false;
const startTime = Date.now();
const timeout = 10000;

function poll() {
  const elapsed = Date.now() - startTime;
  if (elapsed > timeout) {
    console.log(`\n✗ No response after ${timeout/1000}s — GT server did not respond to stock ENet CONNECT`);
    console.log("  GT likely uses a MODIFIED ENet that stock libraries can't handshake with.");
    cleanup();
    return;
  }

  // Service with 100ms timeout
  const event = enet.host.service(client, 100);

  switch (event.type) {
    case ENetEventType.connect:
      connected = true;
      console.log(`\n✓ CONNECTED! GT server accepted stock ENet handshake!`);
      console.log(`  Peer: ${event.peer.address.host}:${event.peer.address.port}`);
      console.log(`  This means a proper ENet proxy IS possible!`);
      
      // Wait a moment for the server to send hello packet
      setTimeout(() => {
        const event2 = enet.host.service(client, 2000);
        if (event2.type === ENetEventType.receive) {
          console.log(`\n✓ Received data: ${event2.packet.data.length} bytes on channel ${event2.channelID}`);
          console.log(`  First 64 bytes: ${event2.packet.data.slice(0, 64).toString("hex")}`);
          
          // Parse GT message type
          if (event2.packet.data.length >= 4) {
            const msgType = event2.packet.data.readUInt32LE(0);
            console.log(`  GT message type: ${msgType} (1=hello, 2=login_info, 3=action, 4=tank)`);
          }
          enet.packet.destroy(event2.packet);
        }
        enet.peer.disconnect(peer, 0);
        setTimeout(cleanup, 1000);
      }, 100);
      return;

    case ENetEventType.disconnect:
      console.log(`\n✗ Disconnected by GT server (data: ${event.data})`);
      cleanup();
      return;

    case ENetEventType.receive:
      console.log(`\n✓ Received data before connect event: ${event.packet.data.length} bytes`);
      enet.packet.destroy(event.packet);
      break;

    case ENetEventType.none:
      // Nothing happened, keep polling
      if (elapsed % 2000 < 100) {
        process.stdout.write(`  Waiting... ${Math.round(elapsed/1000)}s\r`);
      }
      break;
  }

  setImmediate(poll);
}

function cleanup() {
  try { enet.host.destroy(client); } catch {}
  enet.deinitialize();
  console.log("\nDone.");
  process.exit(connected ? 0 : 1);
}

poll();
