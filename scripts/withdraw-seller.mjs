// Withdraws the seller's accrued Gateway earnings to its on-chain Arc wallet,
// producing a real Arcscan transaction — the on-chain proof that per-second
// payments end in real USDC on Arc. Instant same-chain withdrawal (not the
// 7-day trustless path).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const sellerKey = env.SELLER_PRIVATE_KEY;
const seller = privateKeyToAccount(sellerKey).address;
const chain = env.ARC_CHAIN || "arcTestnet";

const RPC = "https://rpc.testnet.arc.network";
const arc = { id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain: arc, transport: http(RPC) });

// The seller wallet holds earnings in the Gateway (off-chain) but no native gas.
// Submitting the on-chain mint needs gas (native USDC), so top it up from the funder.
const sellerGas = await pub.getBalance({ address: seller });
console.log(`seller native gas: ${formatEther(sellerGas)} USDC`);
if (sellerGas < parseEther("0.02") && env.BUYER_PRIVATE_KEY) {
  const funder = privateKeyToAccount(env.BUYER_PRIVATE_KEY);
  const fw = createWalletClient({ account: funder, chain: arc, transport: http(RPC) });
  console.log(`topping up gas from ${funder.address}…`);
  const tx = await fw.sendTransaction({ to: seller, value: parseEther("0.05") });
  await pub.waitForTransactionReceipt({ hash: tx });
  console.log(`  gas sent (${tx.slice(0, 10)}…)`);
}

const { GatewayClient } = await import("@circle-fin/x402-batching/client");
const gw = new GatewayClient({ chain, privateKey: sellerKey });

const before = await gw.getBalances();
const avail = Number(before.gateway.formattedAvailable);
// Circle charges a withdrawal fee (~0.0035 USDC) on top of the amount, so we
// withdraw the available balance minus a safe buffer for that fee.
const FEE_BUFFER = 0.004;
const amount = Math.max(0, Number((avail - FEE_BUFFER).toFixed(6)));
console.log(`seller ${seller}`);
console.log(`gateway available: ${avail} USDC — withdrawing ${amount} (leaving ${FEE_BUFFER} for fee)…`);

if (amount <= 0) {
  console.log("not enough balance to cover the withdrawal fee yet — run more traffic first.");
  process.exit(0);
}

try {
  const res = await gw.transfer(String(amount), chain, seller);
  const tx = res.mintTxHash ?? res.txHash;
  console.log(`\n✓ withdrawn ${res.formattedAmount} USDC to ${res.recipient ?? seller} on-chain`);
  console.log(`  mint tx: ${tx}`);
  console.log(`  explorer: https://testnet.arcscan.app/tx/${tx}`);
} catch (e) {
  console.log("transfer() failed:", e.message);
}
