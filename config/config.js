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

  // Logging
  logging: {
    enabled: true,
    level: "info",
  },
};
