const hardhatViem = require("@nomicfoundation/hardhat-viem").default;

// Load .env so SELLER_PRIVATE_KEY is available at compile/deploy time.
const fs = require("fs");
const path = require("path");
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    });
}

const pk = process.env.SELLER_PRIVATE_KEY;
const accounts = pk ? [pk.startsWith("0x") ? pk : "0x" + pk] : [];

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  plugins: [hardhatViem],
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    arcTestnet: {
      type: "http",
      url: "https://rpc.testnet.arc.network",
      chainId: 5042002,
      accounts,
    },
  },
  paths: {
    artifacts: "./artifacts",
    sources: "./contracts",
    cache: "./cache",
  },
};
