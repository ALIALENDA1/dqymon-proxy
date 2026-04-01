const Logger = require("../utils/Logger");

/**
 * Growtopia Packet Message Types (first 4 bytes, int32 LE)
 */
const MSG_TYPE = {
  HELLO: 1,          // Server/Client hello handshake
  LOGIN_INFO: 2,     // Text key|value pairs (login credentials, server data)
  ACTION: 3,         // Generic text/action packets (action|type\nkey|value)
  TANK: 4,           // Tank packet - binary game state (60-byte header + extra data)
};

/**
 * Tank Packet Sub-Types (byte offset 4 in tank packet payload)
 */
const TANK_TYPE = {
  STATE_UPDATE: 0,
  CALL_FUNCTION: 1,
  UPDATE_STATUS: 2,
  TILE_CHANGE_REQ: 3,
  SEND_MAP_DATA: 5,
  SEND_TILE_UPDATE: 7,
  SEND_INVENTORY: 10,
  ICON_STATE: 14,
  ITEM_CHANGE_OBJ: 18,
  SEND_PARTICLE: 19,
  SET_ICON_STATE: 22,
  PING_REPLY: 25,
};

class PacketHandler {
  constructor() {
    this.logger = new Logger();
  }

  /**
   * Parse Growtopia packet based on actual protocol structure:
   * - First 4 bytes: message type (int32 LE)
   * - Remaining bytes: payload (text for type 2/3, binary for type 4)
   */
  parsePacket(data) {
    try {
      if (data.length < 4) return null;

      const msgType = data.readUInt32LE(0);
      const payload = data.slice(4);

      const packet = {
        type: msgType,
        typeName: this.getTypeName(msgType),
        size: data.length,
        raw: data,
      };

      switch (msgType) {
        case MSG_TYPE.HELLO:
          packet.payload = null;
          break;

        case MSG_TYPE.LOGIN_INFO:
        case MSG_TYPE.ACTION:
          packet.text = payload.toString("utf8").replace(/\0+$/, "");
          packet.pairs = this.parseTextPairs(packet.text);
          break;

        case MSG_TYPE.TANK:
          packet.tank = this.parseTankPacket(payload);
          break;

        default:
          packet.hex = payload.toString("hex");
      }

      return packet;
    } catch (err) {
      this.logger.debug(`Failed to parse packet: ${err.message}`);
      return null;
    }
  }

  /**
   * Parse text key|value pairs from type 2/3 packets
   * Format: "key1|value1\nkey2|value2\n"
   */
  parseTextPairs(text) {
    const pairs = {};
    const lines = text.split("\n");

    for (const line of lines) {
      const sepIndex = line.indexOf("|");
      if (sepIndex !== -1) {
        const key = line.substring(0, sepIndex).trim();
        const value = line.substring(sepIndex + 1).trim();
        if (key) pairs[key] = value;
      }
    }

    return pairs;
  }

  /**
   * Parse 60-byte tank packet header
   * Structure:
   *   [0-3]   tankType (int32 LE) - sub-type
   *   [4-7]   netID (int32 LE)
   *   [8-11]  targetNetID (int32 LE)
   *   [12-15] state (int32 LE)
   *   [20-23] padding
   *   [24-27] posX (float32 LE)
   *   [28-31] posY (float32 LE)
   *   [32-35] speedX (float32 LE)
   *   [36-39] speedY (float32 LE)
   *   [44-47] tileX/intVal (int32 LE)
   *   [48-51] tileY/intVal2 (int32 LE)
   *   [52-55] extraDataSize (int32 LE)
   *   [56+]   extraData (if extraDataSize > 0)
   */
  parseTankPacket(payload) {
    if (payload.length < 56) {
      return { error: "Tank packet too short", size: payload.length };
    }

    const tank = {
      tankType: payload.readUInt32LE(0),
      netID: payload.readInt32LE(4),
      targetNetID: payload.readInt32LE(8),
      state: payload.readUInt32LE(12),
      posX: payload.readFloatLE(24),
      posY: payload.readFloatLE(28),
      speedX: payload.readFloatLE(32),
      speedY: payload.readFloatLE(36),
      intVal: payload.readInt32LE(44),
      intVal2: payload.readInt32LE(48),
      extraDataSize: payload.readUInt32LE(52),
    };

    tank.tankTypeName = this.getTankTypeName(tank.tankType);

    if (tank.extraDataSize > 0 && payload.length >= 56 + tank.extraDataSize) {
      tank.extraData = payload.slice(56, 56 + tank.extraDataSize);
    }

    return tank;
  }

  getTypeName(type) {
    return Object.keys(MSG_TYPE).find((k) => MSG_TYPE[k] === type) || `UNKNOWN(${type})`;
  }

  getTankTypeName(type) {
    return Object.keys(TANK_TYPE).find((k) => TANK_TYPE[k] === type) || `UNKNOWN(${type})`;
  }

  /**
   * Build a text packet (type 2 or 3)
   */
  buildTextPacket(msgType, pairs) {
    const text = Object.entries(pairs)
      .map(([k, v]) => `${k}|${v}`)
      .join("\n") + "\n";
    const textBuf = Buffer.from(text, "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(msgType, 0);
    return Buffer.concat([header, textBuf]);
  }

  // ── Variant packet builder (for OnConsoleMessage, OnTextOverlay, etc.) ──

  /**
   * Serialize a variant list into binary.
   * Each variant is { type, value }:
   *   type 1 = float,  type 2 = string,  type 3 = vec2 [x,y],
   *   type 4 = vec3 [x,y,z],  type 5 = uint32,  type 9 = int32
   */
  static serializeVariantList(variants) {
    const parts = [];

    // Variant count (1 byte)
    const countBuf = Buffer.alloc(1);
    countBuf.writeUInt8(variants.length, 0);
    parts.push(countBuf);

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];

      // Index (1 byte)
      const idxBuf = Buffer.alloc(1);
      idxBuf.writeUInt8(i, 0);
      parts.push(idxBuf);

      // Type (1 byte)
      const typeBuf = Buffer.alloc(1);
      typeBuf.writeUInt8(v.type, 0);
      parts.push(typeBuf);

      switch (v.type) {
        case 1: { // float
          const fb = Buffer.alloc(4);
          fb.writeFloatLE(v.value, 0);
          parts.push(fb);
          break;
        }
        case 2: { // string
          const strBuf = Buffer.from(v.value, "utf8");
          const lenBuf = Buffer.alloc(4);
          lenBuf.writeUInt32LE(strBuf.length, 0);
          parts.push(lenBuf, strBuf);
          break;
        }
        case 3: { // vec2
          const v2 = Buffer.alloc(8);
          v2.writeFloatLE(v.value[0], 0);
          v2.writeFloatLE(v.value[1], 4);
          parts.push(v2);
          break;
        }
        case 4: { // vec3
          const v3 = Buffer.alloc(12);
          v3.writeFloatLE(v.value[0], 0);
          v3.writeFloatLE(v.value[1], 4);
          v3.writeFloatLE(v.value[2], 8);
          parts.push(v3);
          break;
        }
        case 5: { // uint32
          const ub = Buffer.alloc(4);
          ub.writeUInt32LE(v.value, 0);
          parts.push(ub);
          break;
        }
        case 9: { // int32
          const ib = Buffer.alloc(4);
          ib.writeInt32LE(v.value, 0);
          parts.push(ib);
          break;
        }
      }
    }

    return Buffer.concat(parts);
  }

  /**
   * Build a full tank packet that calls a variant function.
   * Returns a complete message (4-byte msg header + 56-byte tank header + variant data).
   */
  static buildVariantPacket(variants, netID = -1, delay = 0) {
    const variantData = PacketHandler.serializeVariantList(variants);

    // 4-byte message header (type 4 = TANK)
    const msgHeader = Buffer.alloc(4);
    msgHeader.writeUInt32LE(MSG_TYPE.TANK, 0);

    // 56-byte tank header
    const tank = Buffer.alloc(56);
    tank.writeUInt32LE(TANK_TYPE.CALL_FUNCTION, 0); // tankType
    tank.writeInt32LE(netID, 4);                     // netID
    tank.writeInt32LE(-1, 8);                        // targetNetID
    tank.writeUInt32LE(8, 12);                       // state flags (0x8 = extra data)
    tank.writeInt32LE(delay, 20);                    // delay
    tank.writeUInt32LE(variantData.length, 52);      // extraDataSize

    return Buffer.concat([msgHeader, tank, variantData]);
  }

  /**
   * Build an OnConsoleMessage packet (shows text in the chat/console).
   */
  static buildConsoleMessage(text) {
    return PacketHandler.buildVariantPacket([
      { type: 2, value: "OnConsoleMessage" },
      { type: 2, value: text },
    ]);
  }

  /**
   * Build an OnTextOverlay packet (shows text centered on screen, fades out).
   */
  static buildTextOverlay(text) {
    return PacketHandler.buildVariantPacket([
      { type: 2, value: "OnTextOverlay" },
      { type: 2, value: text },
    ]);
  }

  /**
   * Inject items (free outfit)
   * TODO: Implementasi actual packet injection
   */
  injectItems(data, clientId) {
    return data;
  }

  /**
   * Modify warp packet
   */
  modifyWarpPacket(packet, targetWorld) {
    // TODO: Implement warp packet modification
    return packet;
  }

  /**
   * Add diamond lock bypass
   */
  bypassDiamondLock(packet) {
    // TODO: Implement DL bypass
    return packet;
  }
}

PacketHandler.MSG_TYPE = MSG_TYPE;
PacketHandler.TANK_TYPE = TANK_TYPE;

module.exports = PacketHandler;
