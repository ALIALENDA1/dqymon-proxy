/**
 * Minimal ENet datagram parser for raw UDP proxy.
 * Parses ENet wire format to extract and modify Growtopia payloads
 * without needing the enet library (version-agnostic).
 */

// ENet protocol command types
const CMD = {
  NONE: 0,
  ACKNOWLEDGE: 1,
  CONNECT: 2,
  VERIFY_CONNECT: 3,
  DISCONNECT: 4,
  PING: 5,
  SEND_RELIABLE: 6,
  SEND_UNRELIABLE: 7,
  SEND_FRAGMENT: 8,
  SEND_UNSEQUENCED: 9,
  BANDWIDTH_LIMIT: 10,
  THROTTLE_CONFIGURE: 11,
  SEND_UNRELIABLE_FRAGMENT: 12,
};

// Fixed-size portion of each command type (after the 4-byte command header:
//   commandByte(1) + channelID(1) + reliableSequenceNumber(2))
const CMD_FIXED = {
  [CMD.ACKNOWLEDGE]: 4,
  [CMD.CONNECT]: 36,
  [CMD.VERIFY_CONNECT]: 36,
  [CMD.DISCONNECT]: 4,
  [CMD.PING]: 0,
  [CMD.SEND_RELIABLE]: 2,          // dataLength(2)
  [CMD.SEND_UNRELIABLE]: 4,        // unreliableSeqNum(2) + dataLength(2)
  [CMD.SEND_FRAGMENT]: 20,         // startSeqNum(2) + dataLen(2) + fragCount(4) + fragNum(4) + totalLen(4) + fragOffset(4)
  [CMD.SEND_UNSEQUENCED]: 4,       // unsequencedGroup(2) + dataLength(2)
  [CMD.BANDWIDTH_LIMIT]: 8,
  [CMD.THROTTLE_CONFIGURE]: 12,
  [CMD.SEND_UNRELIABLE_FRAGMENT]: 20,
};

/**
 * Check whether a byte could be a valid ENet command byte.
 * Low 4 bits = command type (1–12), high bits are flags (bit 7 = ACK, bit 6 = unsequenced).
 */
function isValidCmdByte(b) {
  const t = b & 0x0F;
  return t >= 1 && t <= 12;
}

/**
 * Try to parse ENet commands starting at `startOffset`.
 * Returns array of command descriptors, or null if parsing fails.
 */
function tryParseCommands(buf, startOffset) {
  const commands = [];
  let offset = startOffset;

  while (offset + 4 <= buf.length) {
    const cmdByte = buf[offset];
    if (!isValidCmdByte(cmdByte)) break;

    const cmdType = cmdByte & 0x0F;
    const fixed = CMD_FIXED[cmdType];
    if (fixed === undefined) break;

    const fixedTotal = 4 + fixed; // command header (4) + fixed fields
    if (offset + fixedTotal > buf.length) break;

    let dataLen = 0;
    switch (cmdType) {
      case CMD.SEND_RELIABLE:
        dataLen = buf.readUInt16BE(offset + 4);
        break;
      case CMD.SEND_UNRELIABLE:
      case CMD.SEND_FRAGMENT:
      case CMD.SEND_UNSEQUENCED:
      case CMD.SEND_UNRELIABLE_FRAGMENT:
        dataLen = buf.readUInt16BE(offset + 6);
        break;
    }

    const dataStart = offset + fixedTotal;
    if (dataStart + dataLen > buf.length) {
      // Tolerate minor truncation on the last command
      dataLen = Math.max(0, buf.length - dataStart);
    }

    commands.push({
      cmdType,
      offset,          // start of this command in the buffer
      fixedTotal,      // bytes for command header + fixed fields
      dataStart,       // where variable-length data begins
      dataLen,         // length of variable-length data
    });

    offset = dataStart + dataLen;
  }

  return commands.length > 0 ? commands : null;
}

/**
 * Parse an ENet UDP datagram into header info and commands.
 * Returns { headerSize, hasChecksum, hasSentTime, commands[] } or null.
 */
function parseDatagram(buf) {
  if (buf.length < 6) return null;

  const peerIDField = buf.readUInt16BE(0);
  const hasSentTime = !!(peerIDField & 0x8000);
  const isCompressed = !!(peerIDField & 0x4000);

  // Cannot parse compressed datagrams — relay them as-is
  if (isCompressed) return null;

  const baseOffset = 2 + (hasSentTime ? 2 : 0);

  // Try without checksum first
  let commands = tryParseCommands(buf, baseOffset);
  if (commands) {
    return { headerSize: baseOffset, hasChecksum: false, hasSentTime, commands };
  }

  // Try with 4-byte checksum
  if (baseOffset + 4 < buf.length) {
    commands = tryParseCommands(buf, baseOffset + 4);
    if (commands) {
      return { headerSize: baseOffset + 4, hasChecksum: true, hasSentTime, commands };
    }
  }

  return null;
}

/**
 * Extract Growtopia-level payloads from SEND_RELIABLE / SEND_UNRELIABLE commands.
 * Returns array of { cmd, data: Buffer }.
 */
function extractPayloads(buf) {
  const parsed = parseDatagram(buf);
  if (!parsed) return [];

  const payloads = [];
  for (const cmd of parsed.commands) {
    if (cmd.dataLen > 0 && (
      cmd.cmdType === CMD.SEND_RELIABLE ||
      cmd.cmdType === CMD.SEND_UNRELIABLE
    )) {
      payloads.push({
        cmd,
        data: buf.slice(cmd.dataStart, cmd.dataStart + cmd.dataLen),
      });
    }
  }
  return payloads;
}

/**
 * Replace a command's payload data in the datagram.
 * Adjusts the dataLength field and recalculates checksum if present.
 * Returns a new Buffer.
 */
function replacePayload(buf, cmd, newData) {
  const parsed = parseDatagram(buf);
  if (!parsed) return buf; // can't parse → return unmodified

  const sizeDiff = newData.length - cmd.dataLen;
  const newBuf = Buffer.alloc(buf.length + sizeDiff);

  // Copy everything before the data region
  buf.copy(newBuf, 0, 0, cmd.dataStart);

  // Write new payload data
  newData.copy(newBuf, cmd.dataStart);

  // Copy everything after the old data region
  const afterOld = cmd.dataStart + cmd.dataLen;
  const afterNew = cmd.dataStart + newData.length;
  if (afterOld < buf.length) {
    buf.copy(newBuf, afterNew, afterOld);
  }

  // Update the dataLength field
  switch (cmd.cmdType) {
    case CMD.SEND_RELIABLE:
      newBuf.writeUInt16BE(newData.length, cmd.offset + 4);
      break;
    case CMD.SEND_UNRELIABLE:
    case CMD.SEND_FRAGMENT:
    case CMD.SEND_UNSEQUENCED:
    case CMD.SEND_UNRELIABLE_FRAGMENT:
      newBuf.writeUInt16BE(newData.length, cmd.offset + 6);
      break;
  }

  // Recalculate checksum if present
  if (parsed.hasChecksum) {
    recalculateChecksum(newBuf, parsed.hasSentTime);
  }

  return newBuf;
}

/**
 * Standard CRC32 used by ENet (polynomial 0xEDB88320).
 */
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

/**
 * Recalculate the ENet CRC32 checksum in place.
 */
function recalculateChecksum(buf, hasSentTime) {
  const checksumOffset = 2 + (hasSentTime ? 2 : 0);
  if (checksumOffset + 4 > buf.length) return;

  // Zero out old checksum
  buf.writeUInt32LE(0, checksumOffset);

  // Calculate over entire buffer
  const checksum = crc32(buf);
  buf.writeUInt32LE(checksum, checksumOffset);
}

module.exports = {
  CMD,
  parseDatagram,
  extractPayloads,
  replacePayload,
};
