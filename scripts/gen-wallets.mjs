// Generates throwaway TESTNET wallets and writes them into the .env files for
// both projects. Private keys are written to disk only (gitignored); this script
// prints addresses only. Never paste private keys into chat.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url))); // idle-compute/
const workspace = dirname(root);
const wm = join(workspace, "work-marketplace");

const mk = () => {
  const pk = generatePrivateKey();
  return { pk, address: privateKeyToAccount(pk).address };
};

const main = mk(); // buyer + deployer (THIS is the one to fund)
const seller = mk(); // receives payments

const icEnv = `# generated — TESTNET ONLY, gitignored
PORT=19131
INFERENCE_BASE=http://localhost:8080
INFERENCE_API_KEY=
MODEL=qwen2.5-0.5b-instruct
PRICE_USDC_PER_SECOND=0.0002
PRICE_TICK_SECONDS=1
MIN_CHARGE_USDC=0.000001
PULL_GRACE_SECONDS=8
REQUIRE_IDLE=false
SELLER_ADDRESS=${seller.address}
SELLER_PRIVATE_KEY=${seller.pk}
ARC_CHAIN=arcTestnet
BUYER_PRIVATE_KEY=${main.pk}
BASE_URL=http://localhost:19131
DEPOSIT_AMOUNT=1
`;

const wmEnv = `# generated — TESTNET ONLY, gitignored
PRIVATE_KEY=${main.pk}
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
PROTOCOL_FEE_BPS=250
`;

for (const [path, content] of [
  [join(root, ".env"), icEnv],
  [join(wm, ".env"), wmEnv],
]) {
  if (existsSync(path)) {
    console.log(`! ${path} already exists — leaving it untouched`);
  } else {
    writeFileSync(path, content, "utf8");
    console.log(`wrote ${path}`);
  }
}

console.log("\nWallets (private keys saved to .env, gitignored — not shown):\n");
console.log("  ► FUND THIS ONE (buyer + deployer):");
console.log("      " + main.address);
console.log("  seller — receives payments, no funding needed:");
console.log("      " + seller.address);
console.log("\nFund the first address with Arc testnet USDC at https://faucet.circle.com");
console.log("(USDC is also the gas token on Arc, so that single fund covers gas + payments).");
