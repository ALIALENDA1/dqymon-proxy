/**
 * Packet Analyzer untuk research
 * Dump packets untuk debugging dan reverse engineering
 */

const fs = require("fs");
const path = require("path");
const Logger = require("./Logger");

class PacketAnalyzer {
  constructor() {
    this.logger = new Logger();
    this.packets = [];
    this.dumpDir = path.join(__dirname, "..", "packet_dumps");

    // Create dump directory jika tidak ada
    if (!fs.existsSync(this.dumpDir)) {
      fs.mkdirSync(this.dumpDir, { recursive: true });
    }
  }

  /**
   * Capture dan log packet
   */
  capturePacket(clientId, direction, data) {
    const packet = {
      timestamp: new Date().toISOString(),
      clientId,
      direction, // 'client->server' atau 'server->client'
      size: data.length,
      hex: data.toString("hex"),
      ascii: this.tryAscii(data),
    };

    this.packets.push(packet);

    // Log jika interesting (ada ASCII content)
    if (packet.ascii.length > 0) {
      this.logger.debug(`[${clientId}] ${direction}: ${packet.ascii.substring(0, 50)}...`);
    }
  }

  /**
   * Extract ASCII strings dari binary data
   */
  tryAscii(buffer) {
    let result = "";
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      if (byte >= 32 && byte <= 126) {
        result += String.fromCharCode(byte);
      } else if (byte === 10 || byte === 13) {
        result += "\n";
      } else {
        result += ".";
      }
    }
    return result;
  }

  /**
   * Format packet untuk display
   */
  formatPacket(packet) {
    return `
[${packet.timestamp}]
Direction: ${packet.direction}
Client: ${packet.clientId}
Size: ${packet.size} bytes
Hex:
${this.formatHex(packet.hex)}
ASCII:
${packet.ascii}
---
    `;
  }

  /**
   * Format hex string dengan spacing
   */
  formatHex(hexStr) {
    const chunks = hexStr.match(/.{1,32}/g) || [];
    return chunks.map((chunk) => {
      const spaced = chunk.match(/.{1,2}/g).join(" ");
      return "  " + spaced;
    }).join("\n");
  }

  /**
   * Save semua packets ke file
   */
  dumpToFile(filename = `dump_${Date.now()}.txt`) {
    // Sanitize filename to prevent path traversal
    const sanitized = path.basename(filename);
    const filepath = path.join(this.dumpDir, sanitized);

    let content = "=== GROWTOPIA PACKET DUMP ===\n";
    content += `Generated: ${new Date().toISOString()}\n`;
    content += `Total packets: ${this.packets.length}\n\n`;

    for (const packet of this.packets) {
      content += this.formatPacket(packet);
    }

    fs.writeFileSync(filepath, content);
    this.logger.info(`Packet dump saved: ${filepath}`);
    return filepath;
  }

  /**
   * Save session packets grouped by client
   */
  dumpByClient() {
    const byClient = {};

    for (const packet of this.packets) {
      if (!byClient[packet.clientId]) {
        byClient[packet.clientId] = [];
      }
      byClient[packet.clientId].push(packet);
    }

    for (const [clientId, packets] of Object.entries(byClient)) {
      const filename = `client_${clientId}_${Date.now()}.txt`;
      const filepath = path.join(this.dumpDir, filename);

      let content = `=== CLIENT: ${clientId} ===\n`;
      content += `Packets: ${packets.length}\n\n`;

      for (const packet of packets) {
        content += this.formatPacket(packet);
      }

      fs.writeFileSync(filepath, content);
      this.logger.info(`Client dump saved: ${filepath}`);
    }
  }

  /**
   * Analyze patterns
   */
  analyzePatterns() {
    const patterns = {};

    for (const packet of this.packets) {
      // First 4 bytes might be packet type
      const typeHex = packet.hex.substring(0, 8);

      if (!patterns[typeHex]) {
        patterns[typeHex] = {
          count: 0,
          direction: new Set(),
          sizes: [],
          examples: [],
        };
      }

      patterns[typeHex].count++;
      patterns[typeHex].direction.add(packet.direction);
      patterns[typeHex].sizes.push(packet.size);
      patterns[typeHex].examples.push({
        timestamp: packet.timestamp,
        ascii: packet.ascii.substring(0, 30),
      });
    }

    // Report
    this.logger.info("=== PATTERN ANALYSIS ===");
    for (const [typeHex, data] of Object.entries(patterns)) {
      const avgSize = Math.round(
        data.sizes.reduce((a, b) => a + b, 0) / data.sizes.length
      );
      this.logger.info(
        `Type ${typeHex}: ${data.count}x, avg size ${avgSize}, dirs: ${[...data.direction].join("+")}`
      );
    }

    return patterns;
  }

  /**
   * Clear packets
   */
  clear() {
    this.packets = [];
  }
}

module.exports = PacketAnalyzer;
