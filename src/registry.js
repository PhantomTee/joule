// Viem-based client for InferenceProviderRegistry.sol on Arc Testnet.
// Reads are public (no key needed). Writes (register, reportMetrics, deactivate)
// require SELLER_PRIVATE_KEY — the contract's onlyProvider modifier enforces this.
//
// REGISTRY_ADDRESS must be set in .env after `npm run contracts:deploy`.

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Arc Testnet chain definition for viem
export const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  network: "arcTestnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
};

// ABI — must stay in sync with contracts/InferenceProviderRegistry.sol
export const REGISTRY_ABI = [
  {
    name: "registerProvider",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "modelName",     type: "string"  },
      { name: "basePrice",     type: "uint256" },
      { name: "features",      type: "string"  },
      { name: "walletAddress", type: "address" },
    ],
    outputs: [{ name: "providerId", type: "uint256" }],
  },
  {
    name: "reportMetrics",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "providerId",    type: "uint256" },
      { name: "secondsRun",    type: "uint256" },
      { name: "earnedUsdc",    type: "uint256" },
      { name: "errorCount",    type: "uint64"  },
      { name: "avgLatencyMs",  type: "uint64"  },
    ],
    outputs: [],
  },
  {
    name: "getProvider",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "providerId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id",                    type: "uint256" },
          { name: "modelName",             type: "string"  },
          { name: "basePrice",             type: "uint256" },
          { name: "features",              type: "string"  },
          { name: "walletAddress",         type: "address" },
          { name: "isActive",              type: "bool"    },
          { name: "totalInferenceSeconds", type: "uint256" },
          { name: "totalUSDCEarned",       type: "uint256" },
          { name: "registeredAt",          type: "uint256" },
          { name: "lastReportAt",          type: "uint256" },
          {
            name: "reputation",
            type: "tuple",
            components: [
              { name: "uptimePct",     type: "uint64"  },
              { name: "avgLatencyMs",  type: "uint64"  },
              { name: "errorRatePpm",  type: "uint64"  },
              { name: "totalSessions", type: "uint64"  },
              { name: "totalRevenue",  type: "uint256" },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "getAllProviderIds",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "totalProviders",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "providerIdByWallet",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "deactivateProvider",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "providerId", type: "uint256" }],
    outputs: [],
  },
  // Events
  {
    name: "ProviderRegistered",
    type: "event",
    inputs: [
      { name: "providerId", type: "uint256", indexed: true },
      { name: "wallet",     type: "address", indexed: true },
      { name: "modelName",  type: "string",  indexed: false },
    ],
  },
  {
    name: "MetricsReported",
    type: "event",
    inputs: [
      { name: "providerId",  type: "uint256", indexed: true },
      { name: "secondsRun",  type: "uint256", indexed: false },
      { name: "earnedUsdc",  type: "uint256", indexed: false },
    ],
  },
];

// ── Clients ───────────────────────────────────────────────────────────────────

let _publicClient = null;
let _walletClient = null;
let _account = null;

function publicClient() {
  if (!_publicClient) {
    _publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  }
  return _publicClient;
}

function walletClient() {
  if (!_walletClient) {
    const pk = process.env.SELLER_PRIVATE_KEY;
    if (!pk) throw new Error("SELLER_PRIVATE_KEY not set — needed to write to registry");
    _account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
    _walletClient = createWalletClient({ account: _account, chain: arcTestnet, transport: http() });
  }
  return _walletClient;
}

function registryAddress() {
  const addr = process.env.REGISTRY_ADDRESS;
  if (!addr) throw new Error("REGISTRY_ADDRESS not set — run `npm run contracts:deploy` first");
  return addr;
}

// ── Write functions ───────────────────────────────────────────────────────────

/**
 * Register (or re-register) this node as a provider on-chain.
 * @returns {Promise<bigint>} The stable providerId
 */
export async function registerProvider({ modelName, basePrice, features, walletAddress }) {
  const wc = walletClient();
  const addr = registryAddress();
  // Simulate first to catch reverts cheaply
  await publicClient().simulateContract({
    address: addr, abi: REGISTRY_ABI, functionName: "registerProvider",
    args: [modelName, BigInt(basePrice), features, walletAddress],
    account: _account,
  });
  const hash = await wc.writeContract({
    address: addr, abi: REGISTRY_ABI, functionName: "registerProvider",
    args: [modelName, BigInt(basePrice), features, walletAddress],
  });
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  // Decode the ProviderRegistered event to get the providerId
  const log = receipt.logs[0];
  return log ? BigInt(log.topics[1]) : 0n;
}

/**
 * Report an hourly metrics snapshot to the registry.
 * @returns {Promise<string>} transaction hash
 */
export async function reportMetrics({ providerId, secondsRun, earnedUsdc, errorCount, avgLatencyMs }) {
  const wc = walletClient();
  const addr = registryAddress();
  const hash = await wc.writeContract({
    address: addr, abi: REGISTRY_ABI, functionName: "reportMetrics",
    args: [
      BigInt(providerId),
      BigInt(Math.round(secondsRun)),
      BigInt(Math.round(earnedUsdc)),
      BigInt(errorCount),
      BigInt(Math.round(avgLatencyMs)),
    ],
  });
  await publicClient().waitForTransactionReceipt({ hash });
  return hash;
}

// ── Read functions ────────────────────────────────────────────────────────────

/** Fetch a single provider's full record from the contract. */
export async function getProvider(providerId) {
  const raw = await publicClient().readContract({
    address: registryAddress(), abi: REGISTRY_ABI,
    functionName: "getProvider", args: [BigInt(providerId)],
  });
  return normalise(raw);
}

/** Return all active providers, sorted by the given metric. */
export async function listProviders({ sortBy = "earnings", limit = 50 } = {}) {
  const addr = registryAddress();
  const pc = publicClient();
  const ids = await pc.readContract({ address: addr, abi: REGISTRY_ABI, functionName: "getAllProviderIds" });
  const records = await Promise.all(ids.map((id) =>
    pc.readContract({ address: addr, abi: REGISTRY_ABI, functionName: "getProvider", args: [id] })
      .then(normalise)
      .catch(() => null)
  ));
  const active = records.filter((r) => r && r.isActive);
  active.sort((a, b) => {
    switch (sortBy) {
      case "latency":  return a.reputation.avgLatencyMs - b.reputation.avgLatencyMs;
      case "uptime":   return b.reputation.uptimePct    - a.reputation.uptimePct;
      case "price":    return a.basePriceUsdc           - b.basePriceUsdc;
      case "earnings":
      default:         return b.totalUSDCEarnedNum       - a.totalUSDCEarnedNum;
    }
  });
  return active.slice(0, limit);
}

/** Get the providerId mapped to a wallet address (0n = not registered). */
export async function getProviderIdForWallet(wallet) {
  return publicClient().readContract({
    address: registryAddress(), abi: REGISTRY_ABI,
    functionName: "providerIdByWallet", args: [wallet],
  });
}

// Convert raw contract tuple to a plain JS object with human-readable values.
function normalise(raw) {
  if (!raw) return null;
  const r = raw.reputation || {};
  return {
    id:                    Number(raw.id),
    modelName:             raw.modelName,
    basePriceUsdc:         Number(raw.basePrice) / 1e6,
    features:              raw.features ? raw.features.split(",").map((s) => s.trim()).filter(Boolean) : [],
    walletAddress:         raw.walletAddress,
    isActive:              raw.isActive,
    totalInferenceSeconds: Number(raw.totalInferenceSeconds),
    totalUSDCEarnedNum:    Number(raw.totalUSDCEarned) / 1e6,
    registeredAt:          Number(raw.registeredAt),
    lastReportAt:          Number(raw.lastReportAt),
    reputation: {
      uptimePct:     Number(r.uptimePct),
      avgLatencyMs:  Number(r.avgLatencyMs),
      errorRatePpm:  Number(r.errorRatePpm),
      totalSessions: Number(r.totalSessions),
      totalRevenue:  Number(r.totalRevenue) / 1e6,
    },
  };
}

// Re-export viem helpers for deployment script
export { parseUnits, formatUnits };
