#!/usr/bin/env node
// Register this node as a provider on InferenceProviderRegistry.sol.
//
//   npm run provider:register
//
// Reads MODEL, PRICE_USDC_PER_SECOND, SELLER_ADDRESS, REGISTRY_ADDRESS from .env.
// On success, prints the providerId — save it to .env as PROVIDER_ID.

import { readFile, appendFile } from "node:fs/promises";
import { resolve, dirname }     from "node:path";
import { fileURLToPath }        from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, "..");

// Load .env
try {
  const env = await readFile(resolve(root, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^['"]|['"]$/g, "").trim();
  }
} catch {}

for (const v of ["SELLER_PRIVATE_KEY", "SELLER_ADDRESS", "REGISTRY_ADDRESS"]) {
  if (!process.env[v]) { console.error(`${v} not set — check .env`); process.exit(1); }
}

const { registerProvider, getProviderIdForWallet } = await import("../src/registry.js");

// Check if already registered
const existing = await getProviderIdForWallet(process.env.SELLER_ADDRESS).catch(() => 0n);
if (existing && existing > 0n) {
  console.log(`Already registered as provider #${existing}`);
  console.log(`PROVIDER_ID=${existing}`);
  process.exit(0);
}

const modelName  = process.env.MODEL || "qwen2.5-0.5b-instruct";
const basePrice  = Math.round(Number(process.env.PRICE_USDC_PER_SECOND || 0.0002) * 1e6);
const features   = ["streaming", "tapToStop", "dynamicPricing"].join(",");
const wallet     = process.env.SELLER_ADDRESS;

console.log(`Registering provider on Arc Testnet…`);
console.log(`  model     : ${modelName}`);
console.log(`  basePrice : ${basePrice} atomic (${basePrice / 1e6} USDC/sec)`);
console.log(`  wallet    : ${wallet}`);
console.log(`  registry  : ${process.env.REGISTRY_ADDRESS}`);

const providerId = await registerProvider({ modelName, basePrice, features, walletAddress: wallet });
console.log(`\n  ✅ Provider registered: #${providerId}`);
console.log(`\n  Add to .env:\n  PROVIDER_ID=${providerId}\n`);

// Optionally auto-append to .env if PROVIDER_ID isn't already there
const envPath = resolve(root, ".env");
try {
  const current = await readFile(envPath, "utf8");
  if (!current.includes("PROVIDER_ID=")) {
    await appendFile(envPath, `\nPROVIDER_ID=${providerId}\n`, "utf8");
    console.log("  Auto-appended PROVIDER_ID to .env");
  }
} catch {}
