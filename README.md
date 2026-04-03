# dqymon-proxy

MITM proxy for Growtopia built on [growtopia.js](https://github.com/JadlionHD/growtopia.js) — intercepts HTTPS login, rewrites server addresses, and relays all ENet game traffic with full packet inspection and custom commands.

## Features

- **ENet Bridge Proxy** — Uses growtopia.js (Rust-based ENet) for proper Growtopia handshake. Accepts client connections on one side, opens a real ENet session to the GT server on the other, and relays everything in between.
- **HTTPS Login Interception** — Hooks into Growtopia's login endpoint via hosts file redirect, rewrites `server_data` to point the client at the proxy, strips `#maint` flags.
- **Sub-Server Redirect Handling** — Intercepts `OnSendToServer` variant calls and transparently reroutes the client through the proxy when switching worlds/sub-servers.
- **Device Spoofing** — Randomizes MAC, RID, hash, hash2, fhash, and zf fields in login packets to mask device fingerprints. Identity is preserved across sub-server redirects to avoid "Bad logon".
- **Custom Commands** — In-game `/dropdl`, `/warp`, `/outfit`, `/help`. Commands are intercepted before reaching the server — the server never sees your command text.
- **Game Event Logging** — Tracks variant calls (`OnSpawn`, `OnSetClothing`, `OnTalkBubble`, etc.), player movements, tile changes, and inventory updates.
- **Packet Analyzer** — Captures, hex-dumps, and exports packets for protocol research.
- **Configurable Logging** — Leveled logger (debug / info / warn / error) with timestamps.

## How It Works

```
Growtopia Client
      │
      ▼
  HTTPS Login ──► LoginServer (local HTTPS) ──► Growtopia Login API
      │               rewrites server_data
      ▼               to 127.0.0.1:17091
  ENet Client
      │
      ▼
  serverClient (port 17091)     ◄── growtopia.js ENet server
      │
      │  relay packets
      ▼
  outgoingClient (ephemeral)    ◄── growtopia.js ENet client
      │
      ▼
  Real GT Server (213.179.209.x)
```

## Project Structure

```
index.js                       # Main proxy — ENet bridge, session management, packet relay
diagnose.js                    # Standalone diagnostic/packet capture tool
config/
  config.js                    # Proxy, server, spoof, game launcher, and logging settings
handlers/
  CommandHandler.js            # In-game slash commands (/dropdl, /warp, /outfit, /help)
  PacketHandler.js             # Packet parser/builder (text pairs, tank packets, variant calls)
utils/
  LoginServer.js               # HTTPS login interceptor, server_data rewriter
  GameLauncher.js              # Hosts file modification, DNS flush, game auto-launch
  GameEventLogger.js           # Variant call parser, player/world tracking
  Logger.js                    # Leveled console logger
  PacketAnalyzer.js            # Packet capture, hex formatting, dump-to-file
  ENetParser.js                # Multi-layout ENet packet scoring parser
  GameLog.js                   # Game event log storage
```

## Installation

```bash
npm install
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `growtopia.js` | Rust-based ENet library with Growtopia's custom handshake |
| `dotenv` | Environment variable loading |

Dev: `nodemon` (auto-reload), `@yao-pkg/pkg` (single-binary Windows builds)

## Configuration

Edit [`config/config.js`](config/config.js):

```js
proxy: {
  host: "0.0.0.0",
  port: 17091,
  maxPeers: 32,
  channels: 2,
}

serverConfig: {
  host: "207.180.219.24",
  port: 17091,
  channels: 2,
}

spoof: {
  enabled: true,
  mac: "random",       // "random" or "02:xx:xx:xx:xx:xx"
  rid: "random",
  hash: "random",
  hash2: "random",
  fhash: "random",
  zf: "random",
}

game: {
  autoLaunch: true,
  path: null,          // auto-detect or set path
  modifyHosts: true,   // redirect GT domains to proxy via hosts file
}

logging: {
  enabled: true,
  level: "info",       // debug | info | warn | error
}
```

## Usage

### Start the proxy

```bash
npm start
# or with auto-reload:
npm run dev
```

The proxy will:
1. Start an HTTPS login server (intercepts Growtopia login)
2. Modify the hosts file to redirect Growtopia domains to localhost
3. Launch Growtopia (if `game.autoLaunch` is true)
4. Accept ENet connections on port 17091 and relay to the real server

### Build standalone Windows exe

```bash
npm run build
```

Output: `dist/dqymon-proxy.exe` + `dist/growtopia-js.win32-x64-msvc.node` (must be in the same folder).

### Commands

All commands are intercepted by the proxy and **never sent to the server**.

| Command | Description | Safety |
|---------|-------------|--------|
| `/dropdl <amount>` | Drop Diamond Locks from your inventory (max 200) | Server-validated — you must own the DLs |
| `/warp <world>` | Warp to a world | Server-validated — same as typing in door |
| `/outfit <hat> [shirt] [pants] [shoes] [face] [hand] [back] [hair] [neck]` | Change visual outfit | Client-side only — other players see your real outfit |
| `/help` | List available commands | — |

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
