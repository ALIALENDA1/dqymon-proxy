# dqymon-proxy

ENet-based proxy server for Growtopia with packet interception, custom commands, and a packet analyzer for protocol research.

## Features

- **ENet/UDP Proxy** — Sits between the Growtopia client and server, forwarding traffic over ENet with full packet inspection
- **Packet Parsing** — Decodes Growtopia protocol message types (Hello, Login, Action, Tank) including 60-byte tank packet headers
- **Custom Commands** — In-game commands: `/dropdl`, `/warp`, `/outfit`, `/item`, `/help`
- **Multi-session** — Handles up to 32 concurrent player connections
- **Packet Analyzer** — Captures, dumps, and formats packets for reverse engineering (hex + ASCII views, file export)
- **Configurable Logging** — Leveled logger (debug / info / warn / error) with timestamps

## Project Structure

```
index.js                  # Main proxy server (ENet host, session management, packet relay)
config/
  config.js               # Proxy, server, commands, cheats, and logging settings
handlers/
  CommandHandler.js        # Parses and executes in-game slash commands
  PacketHandler.js         # Packet parser/builder (text pairs, tank packets), item injection stubs
utils/
  Logger.js               # Leveled console logger
  PacketAnalyzer.js        # Packet capture, hex formatting, and dump-to-file utility
```

## Installation

```bash
npm install
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `enet` | ENet networking (UDP) |
| `dotenv` | Environment variable loading |

Dev: `nodemon` (auto-reload), `pkg` (single-binary builds)

## Configuration

Edit [`config/config.js`](config/config.js):

```js
// Proxy — where the client connects
proxy: {
  host: "0.0.0.0",        // Listen address
  port: 17091,             // Listen port (default GT port)
  maxPeers: 32,
  channels: 2,
}

// Real Growtopia server to forward to
serverConfig: {
  host: "207.180.219.24",
  port: 17091,
  channels: 2,
}

// Toggle cheat modules
cheats: {
  freeDL: true,
  freeOutfit: true,
  warpAnywhere: true,
  freePlace: false,
}

// Logging
logging: {
  enabled: true,
  level: "info",           // debug | info | warn | error
}
```

## Usage

### Start the proxy

```bash
npm start
# or with auto-reload:
npm run dev
```

### Build standalone binary

```bash
# Windows x64
npm run build

# Windows + Linux + macOS
npm run build:all
```

Output goes to `dist/`.

### Point the Growtopia client at the proxy

Set the client's server address to:
- **Host**: `127.0.0.1` (or wherever the proxy is running)
- **Port**: `17091` (matches `config.proxy.port`)

### Commands

All commands use the `/` prefix (configurable in `config.commands.prefix`).

| Command | Description |
|---------|-------------|
| `/dropdl <amount>` | Drop Diamond Locks |
| `/warp <world>` | Warp to a world |
| `/outfit <itemid>` | Give a free outfit item |
| `/item <itemid> [amount]` | Give an item |
| `/help` | List available commands |

## Packet Protocol Reference

| Msg Type | Name | Payload |
|----------|------|---------|
| 1 | HELLO | Handshake (no payload) |
| 2 | LOGIN_INFO | Text key\|value pairs |
| 3 | ACTION | Text key\|value pairs |
| 4 | TANK | 60-byte binary header + optional extra data |

Tank sub-types: `STATE_UPDATE`, `CALL_FUNCTION`, `TILE_CHANGE_REQ`, `SEND_MAP_DATA`, `SEND_INVENTORY`, `ITEM_CHANGE_OBJ`, `PING_REPLY`, and more — see [`handlers/PacketHandler.js`](handlers/PacketHandler.js) for the full list.

## License

MIT
