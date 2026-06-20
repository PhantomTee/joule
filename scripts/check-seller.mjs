// Verifies the SELLER actually received the buyer's per-second payments into its
// Circle Gateway balance — i.e. the money is real, not just logged locally.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const sellerKey = env.SELLER_PRIVATE_KEY;
const seller = privateKeyToAccount(sellerKey).address;
console.log("seller:", seller);

const { GatewayClient } = await import("@circle-fin/x402-batching/client");
const gw = new GatewayClient({ chain: env.ARC_CHAIN || "arcTestnet", privateKey: sellerKey });

try {
  const b = await gw.getBalances();
  console.log("gateway available:", b?.gateway?.formattedAvailable ?? b?.gateway?.available);
  console.log("wallet balance:   ", b?.wallet?.formattedBalance ?? b?.wallet?.balance);
  console.log("\nraw:", JSON.stringify(b, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
} catch (e) {
  console.log("getBalances error:", e.message);
}
