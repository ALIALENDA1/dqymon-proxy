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
 *
 * Growtopia uses a MODIFIED ENet that always includes the 2-byte sentTime
 * field but does NOT set the sentTime flag (bit 15) in the peerID word.
 * We try multiple header layouts and pick the best one (most valid commands
 * parsed, with CRC32 match preferred).
 *
 * Returns { headerSize, hasChecksum, hasSentTime, commands[] } or null.
 */
function parseDatagram(buf) {
  if (buf.length < 6) return null;

  const peerIDField = buf.readUInt16BE(0);
  const flagSentTime = !!(peerIDField & 0x8000);
  const isCompressed = !!(peerIDField & 0x4000);

  // Cannot parse compressed datagrams — relay them as-is
  if (isCompressed) return null;

  // Build candidate layouts to try.
  // GT always includes sentTime (2 bytes at offset 2) but does NOT set the flag.
  // We try all combinations and score them by quality.
  const candidates = [];

  const offsets = flagSentTime
    ? [4]          // Flag says sentTime → header = 4 bytes
    : [2, 4];      // Flag says no sentTime → try both (GT lies about this)

  for (const base of offsets) {
    const actualSentTime = base === 4;

    // Without checksum
    let cmds = tryParseCommands(buf, base);
    if (cmds) {
      candidates.push({
        headerSize: base, hasChecksum: false,
        hasSentTime: actualSentTime, commands: cmds,
        score: scoreCandidate(cmds, buf, -1, 0),
      });
    }

    // With 4-byte checksum after the base header
    if (base + 4 < buf.length) {
      cmds = tryParseCommands(buf, base + 4);
      if (cmds) {
        const crcOk = verifyCRC32(buf, base);
        candidates.push({
          headerSize: base + 4, hasChecksum: true,
          hasSentTime: actualSentTime, commands: cmds,
          score: scoreCandidate(cmds, buf, base, crcOk ? 10 : 0),
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Pick the best candidate (highest score)
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

/**
 * Score a parsing candidate. Higher = more likely correct.
 *  - CRC32 match bonus: +20
 *  - CONNECT/VERIFY_CONNECT perfectly fills buffer: +15
 *  - Commands consume entire buffer exactly: +5
 *  - Data-carrying commands with plausible GT payload type (1-10): +8
 *  - Each valid command type: +1
 */
function scoreCandidate(commands, buf, crcOffset, bonus) {
  let score = bonus;
  for (const cmd of commands) {
    score += 1; // valid command

    // CONNECT or VERIFY_CONNECT that perfectly fills remaining buffer
    if ((cmd.cmdType === CMD.CONNECT || cmd.cmdType === CMD.VERIFY_CONNECT) &&
        cmd.offset + cmd.fixedTotal + cmd.dataLen === buf.length) {
      score += 15;
    }

    // Check if data-carrying command has a valid GT message type (1-10)
    if (cmd.dataLen >= 4) {
      const gtType = buf.readUInt32LE(cmd.dataStart);
      if (gtType >= 1 && gtType <= 10) score += 8;
    }
  }
  // Check if commands consume the entire remaining buffer
  const lastCmd = commands[commands.length - 1];
  const endOffset = lastCmd.dataStart + lastCmd.dataLen;
  if (endOffset === buf.length) score += 5;
  return score;
}

/**
 * Verify CRC32 checksum at the given offset.
 */
function verifyCRC32(buf, checksumOffset) {
  if (checksumOffset + 4 > buf.length) return false;
  const stored = buf.readUInt32LE(checksumOffset);
  const testBuf = Buffer.from(buf);
  testBuf.writeUInt32LE(0, checksumOffset);
  return crc32(testBuf) === stored;
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
