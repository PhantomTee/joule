// Checks the funded wallet's Arc testnet balances (native gas + ERC-20 USDC).
import { createPublicClient, http, erc20Abi, formatUnits, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const account = privateKeyToAccount(env.BUYER_PRIVATE_KEY);
const client = createPublicClient({ transport: http("https://rpc.testnet.arc.network") });
const USDC = "0x3600000000000000000000000000000000000000";

const native = await client.getBalance({ address: account.address });
let erc20 = 0n;
try {
  erc20 = await client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
} catch (e) {
  console.log("erc20 read note:", e.shortMessage ?? e.message);
}

console.log("wallet:", account.address);
console.log("native gas (USDC, 18dp):", formatEther(native));
console.log("ERC-20 USDC (6dp):      ", formatUnits(erc20, 6));
console.log(native > 0n ? "\n✓ funded — ready to deploy + run" : "\n✗ no funds yet at this address");
