#!/usr/bin/env node
// Deploy InferenceProviderRegistry.sol to Arc Testnet.
//
//   npm run contracts:deploy
//
// On success, prints the contract address. Add it to .env as REGISTRY_ADDRESS.
// The ABI is also written to src/contracts/InferenceProviderRegistry.abi.json
// so src/registry.js can import it at runtime without the full artifacts/ tree.

import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, "..");

// ── Load .env manually (--env-file-if-exists not available in scripts) ────────
try {
  const env = await readFile(resolve(root, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^['"]|['"]$/g, "");
  }
} catch {}

const pk = process.env.SELLER_PRIVATE_KEY;
if (!pk) { console.error("SELLER_PRIVATE_KEY not set in .env"); process.exit(1); }

// ── Arc Testnet ───────────────────────────────────────────────────────────────
const arc = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
};
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const pc = createPublicClient({ chain: arc, transport: http() });
const wc = createWalletClient({ account, chain: arc, transport: http() });

// ── Load compiled artifact (produced by `npm run contracts:compile`) ───────────
const artifactPath = resolve(root, "artifacts/contracts/InferenceProviderRegistry.sol/InferenceProviderRegistry.json");
let artifact;
try {
  artifact = JSON.parse(await readFile(artifactPath, "utf8"));
} catch {
  console.error("Compiled artifact not found. Run `npm run contracts:compile` first.");
  process.exit(1);
}

const { abi, bytecode } = artifact;
if (!bytecode || bytecode === "0x") {
  console.error("Bytecode empty — compilation may have failed.");
  process.exit(1);
}

// ── Deploy ────────────────────────────────────────────────────────────────────
console.log(`Deploying InferenceProviderRegistry to Arc Testnet…`);
console.log(`  deployer : ${account.address}`);

const balance = await pc.getBalance({ address: account.address });
console.log(`  balance  : ${Number(balance) / 1e18} ETH`);

const hash = await wc.deployContract({ abi, bytecode, args: [] });
console.log(`  tx hash  : ${hash}`);
console.log("  waiting for confirmation…");

const receipt = await pc.waitForTransactionReceipt({ hash });
const address = receipt.contractAddress;
console.log(`\n  ✅ Deployed at: ${address}`);
console.log(`  Explorer : https://testnet.arcscan.app/address/${address}`);
console.log(`\n  Add to .env:\n  REGISTRY_ADDRESS=${address}\n`);

// ── Save ABI for runtime use ──────────────────────────────────────────────────
const abiOut = resolve(root, "src/contracts");
await mkdir(abiOut, { recursive: true });
await writeFile(
  resolve(abiOut, "InferenceProviderRegistry.abi.json"),
  JSON.stringify(abi, null, 2),
  "utf8"
);
console.log("  ABI saved to src/contracts/InferenceProviderRegistry.abi.json");
