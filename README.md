# Growtopia Proxy

Proxy server untuk Growtopia dengan custom commands dan cheats.

## Features

✅ **Packet Interception** - Intercept dan modify packets antara client dan server
✅ **Custom Commands** - /dropdl, /warp, /outfit, /item
✅ **Free Items** - Client-sided item spawning
✅ **Multi-player** - Support multiple concurrent connections
✅ **Logging** - Debug packet flow

## Installation

```bash
npm install
```

## Configuration

Edit `config/config.js` untuk setup:

```javascript
proxy: {
  host: "127.0.0.1",      // Proxy listen address
  port: 18000,            // Proxy listen port
}

serverConfig: {
  host: "207.180.219.24", // Growtopia server
  port: 17091,            // Growtopia port
}

cheats: {
  freeDL: true,          // Bypass Diamond Lock
  freeOutfit: true,      // Free items
  warpAnywhere: true,    // Warp anywhere
}
```

## Usage

### Start Proxy

```bash
npm start
```

### Configure Client

**Di Growtopia client**, ubah server address ke:
- **Host**: 127.0.0.1 (localhost)
- **Port**: 18000 (sesuai config)

### Commands

```
/dropdl <amount>      - Drop DL (Diamond Locks)
/warp <world>         - Warp ke world tanpa exit
/outfit <itemid>      - Give free outfit item
/item <itemid> [amt]  - Give item
/help                 - Show commands
```

## License

MIT
