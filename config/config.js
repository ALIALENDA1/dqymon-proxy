module.exports = {
  // Proxy Settings (ENet/UDP)
  proxy: {
    host: "0.0.0.0",
    port: 17091,       // Listen on the default Growtopia port
    maxPeers: 32,
    channels: 2,       // Growtopia uses 2 channels
  },

  // Growtopia Server Settings
  serverConfig: {
    host: "207.180.219.24",
    port: 17091,
    channels: 2,
  },

  // Command Settings
  commands: {
    prefix: "/",
    enabled: true,
  },

  // Cheat Settings
  cheats: {
    freeDL: true,
    freeOutfit: true,
    warpAnywhere: true,
    freePlace: false,
  },

  // Device Spoofing — modify device fingerprints in login packets
  spoof: {
    enabled: true,
    mac: "random",        // "random" = new each session, or set "02:xx:xx:xx:xx:xx"
    rid: "random",        // "random" = new each session, or set hex string
    hash: "random",       // "random" = new each session
    hash2: "random",
    fhash: "random",
    zf: "random",
  },

  // Game Launcher
  game: {
    autoLaunch: true,        // Automatically open Growtopia on proxy start
    path: null,              // Auto-detect, or set manually e.g. "C:\\Program Files\\Growtopia\\Growtopia.exe"
    modifyHosts: true,       // Redirect Growtopia domains to proxy via hosts file
  },

  // Logging
  logging: {
    enabled: true,
    level: "info",
  },
};
