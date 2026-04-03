# dqymon-proxy

MITM proxy for Growtopia built on [growtopia.js](https://github.com/JadlionHD/growtopia.js) — intercepts HTTPS login, rewrites server addresses, and relays all ENet game traffic with full packet inspection, 100+ custom commands, and an in-game dialog UI.

## Features

- **ENet Bridge Proxy** — Uses growtopia.js (Rust-based ENet) for proper Growtopia handshake. Accepts client connections on one side, opens a real ENet session to the GT server on the other, and relays everything in between.
- **HTTPS Login Interception** — Hooks into Growtopia's login endpoint via hosts file redirect, rewrites `server_data` to point the client at the proxy, strips `#maint` flags.
- **Sub-Server Redirect Handling** — Intercepts `OnSendToServer` variant calls and transparently reroutes the client through the proxy when switching worlds/sub-servers.
- **Device Spoofing** — Randomizes MAC, RID, hash, hash2, fhash, and zf fields in login packets to mask device fingerprints. Identity is preserved across sub-server redirects to avoid "Bad logon".
- **100+ Custom Commands** — Intercepted before reaching the server. Covers navigation, economy, world admin, player radar, social, visuals, and more.
- **In-Game Dialog UI** — Full menu system (`/menu`) with 9 category panels and 11 picker sub-dialogs for weather, skin colors, flags, zoom, outfits, drops, locks, items, and more.
- **Game Event Logging** — Tracks variant calls (`OnSpawn`, `OnSetClothing`, `OnTalkBubble`, etc.), player movements, tile changes, inventory updates, dropped items, and world ownership.
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
  CommandHandler.js            # 100+ in-game slash commands
  MenuHandler.js               # In-game dialog UI — main menu, 9 panels, 11 picker dialogs
  PacketHandler.js             # Packet parser/builder (text pairs, tank packets, variant calls)
utils/
  DialogBuilder.js             # Fluent builder for Growtopia dialog DSL
  LoginServer.js               # HTTPS login interceptor, server_data rewriter
  GameLauncher.js              # Hosts file modification, DNS flush, game auto-launch
  GameEventLogger.js           # Variant call parser, player/world/inventory tracking
  ConfigStore.js               # Persistent JSON config (accounts, saved worlds, home)
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
npm run build        # proxy only
npm run build:all    # proxy + diagnose tool
```

Output: `dist/dqymon-proxy.exe` + `dist/growtopia-js.win32-x64-msvc.node` (must be in the same folder).

## Commands

All commands are intercepted by the proxy and **never sent to the server**. Type `/menu` or `/m` in-game to open the visual dialog UI.

### Core System

| Command | Description |
|---------|-------------|
| `/menu`, `/m` | Open the in-game dialog menu |
| `/proxy` | Show proxy info |
| `/help` | List all commands |
| `/ping` | Connection info |
| `/stats` | Session statistics |
| `/logs` | View log file paths |
| `/clear` | Clear chat console |
| `/hide` | Toggle proxy log suppression |
| `/panic` | Stop all automations |
| `/reboot` | Reconnect to server |
| `/exit` | Close proxy |
| `/re` | Quick reconnect |
| `/keep` | Save config to disk |
| `/settings` | View current config |

### Account & Identity

| Command | Description |
|---------|-------------|
| `/switch <name> <pass>` | Switch account |
| `/account <action>` | Manage accounts |
| `/mac [random\|value]` | Randomize/set MAC |
| `/rid` | Randomize RID |
| `/wk <name> <pass>` | Save credentials |
| `/guest` | Toggle guest mode |
| `/pass <password>` | Set password |
| `/nick <name>` | Set nickname |
| `/relog` | Quick relog |
| `/checkacc` | Account info |
| `/server` | Server info |

### Navigation

| Command | Description |
|---------|-------------|
| `/warp <world>` | Warp to a world |
| `/home` | Warp to home world |
| `/sethome` | Set current world as home |
| `/back` | Return to previous world |
| `/rndm` | Warp to random world |
| `/tutorial` | Warp to START |
| `/leave`, `/logoff` | Leave current world |
| `/door <id>` | Enter a door |
| `/worlds` | List saved worlds |
| `/save <world>` | Save a world |
| `/history` | Recent world history |

### Passive Radar

| Command | Description |
|---------|-------------|
| `/growscan` | Full world report |
| `/players`, `/list` | Player list |
| `/find <name>` | Find a player |
| `/locate <name>` | Locate player position |
| `/mods` | Detect moderators |
| `/hidden` | Show invisible players |
| `/owner` | World lock owner |
| `/floating` | Dropped items |
| `/gems` | Gem count |
| `/chest` | Chest contents |
| `/spirit` | Spirit info |
| `/blocks` | Block count |
| `/check` | World check |
| `/track <name>` | Track player movement |

### Economy

| Command | Description |
|---------|-------------|
| `/balance` | Gem & lock balance |
| `/backpack`, `/inv` | Inventory list |
| `/buy <id> [amount]` | Buy item (max 200) |
| `/trash <id> [amount]` | Trash item (max 200) |
| `/equip <id>` | Wear an item |
| `/unequip <id>` | Remove an item |
| `/upgrade` | Buy backpack slot |
| `/drop <amount>` | Drop Diamond Locks (max 200) |
| `/cdrop <wl\|dl> <amount>` | Drop WLs or DLs |
| `/ddrop <amount>` | Drop DLs (alias) |
| `/daw` | Drop all World Locks |
| `/lock <sl\|bl\|wl\|dl\|bgl>` | Place lock at feet |
| `/fastvend <buy\|sell> <id> <qty>` | Quick buy/sell |
| `/tax <rate>` | Set tax rate |
| `/game <wl_amount>` | Tax calculator |
| `/split <amount> <people>` | Split calculator |
| `/count <items>` | Count calculator |
| `/accept` | Accept trade |

### World Admin

| Command | Description |
|---------|-------------|
| `/pullall` | Pull all players |
| `/kickall` | Kick all players |
| `/banall` | Ban all players |
| `/unall` | Unban all players |
| `/accessall` | Grant access to all |
| `/clearbans` | Clear all bans |
| `/wbans` | View ban list |
| `/wm <normal\|kick\|pull\|ban>` | Set wrench mode |
| `/ignore <name>` | Ignore a player |
| `/level <level>` | Set world level |
| `/guild <name>` | Set guild tag |
| `/wrench <name>` | Wrench a player |
| `/trade <name>` | Trade with player |

### Social

| Command | Description |
|---------|-------------|
| `/msg <name> <text>` | Send private message |
| `/sb <text>` | Super broadcast (local) |
| `/me <text>` | Action message |
| `/copy <name>` | Copy player name |
| `/filter <word>` | Add chat filter |

### Client Illusions (client-side only)

| Command | Description |
|---------|-------------|
| `/clothes <hat> [shirt] ... [neck]` | Change outfit (9 slots) |
| `/name <text>` | Change display name |
| `/title <text>` | Change title |
| `/skin <colorID>` | Change skin color |
| `/invis`, `/ghost` | Toggle invisibility |
| `/flag <id>` | Change country flag |
| `/country <code>` | Set country |
| `/mod` | Moderator visual |
| `/dev` | Developer visual |
| `/weather <id>` | Set weather effect |
| `/night` | Dark weather (Nether) |
| `/zoom <1-10>` | Set camera zoom |
| `/fakeban` | Show fake ban overlay |
| `/replace <id>` | Replace tile visuals |

## In-Game Menu UI

Type `/menu` to open the dialog menu. It has 9 category panels:

| Panel | Contents |
|-------|----------|
| **Core System** | Ping, stats, logs, clear, hide mode, panic, reboot |
| **Account & Login** | Switch, MAC/RID, guest mode, relog |
| **Navigation** | Warp input, home, back, random, saved worlds, history |
| **Passive Radar** | Player list, mod check, find, hidden players, dropped items |
| **Economy** | Balance, backpack, tax calc, drop/lock/equip/buy/trash/vend pickers |
| **World Admin** | Pull/kick/ban all, wrench mode selector |
| **Social** | PM, super broadcast |
| **Client Illusions** | Weather/skin/flag/zoom/outfit pickers |
| **Settings** | Save config, view config, tax rate |

### Picker Dialogs

Commands involving choices open visual picker dialogs instead of requiring memorized IDs:

- **Weather Picker** — 20 named weather effects with one-click buttons
- **Skin Color Picker** — 15 color presets (Default, Pale, Red, Ghost, etc.)
- **Flag Picker** — 24 country flags (US, UK, Japan, Brazil, etc.)
- **Zoom Picker** — 10 zoom levels with visual buttons
- **Outfit Editor** — 9 clothing slot inputs (hat, shirt, pants, shoes, face, hand, back, hair, neck)
- **Drop Picker** — Choose WL or DL with amount input
- **Lock Placer** — 5 lock types (SL, BL, WL, DL, BGL)
- **Equip/Unequip** — Shows inventory items as buttons + manual ID input
- **Buy / Trash / Fast Vend** — Item ID and amount dialogs

All pickers support custom ID input and have back navigation to their parent panel.

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
