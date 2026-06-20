// CLI buyer: opens a paid session and pays per second, streaming tokens to the
// terminal. With --stop-after N it taps stop after N seconds (provider frees the
// model). For the browser version, run `npm run console`.
//
//   node src/buyer.js --prompt "Explain Arc" [--stop-after 3] [--deposit 1]

import { config } from "./config.js";
import { makeGateway, runSession } from "./buyer-core.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const baseUrl = process.env.BASE_URL ?? `http://localhost:${config.port}`;
const prompt = arg("prompt", "Explain Circle Arc and nanopayments in two sentences.");
const stopAfter = Number(arg("stop-after", "0"));
const deposit = arg("deposit", process.env.DEPOSIT_AMOUNT ?? "1");

const gateway = await makeGateway();
console.log(`Depositing ${deposit} USDC into Gateway Wallet…`);
await gateway.deposit(deposit);

console.log(`\n> ${prompt}\n`);
const startedAt = Date.now();

const result = await runSession({
  gateway,
  baseUrl,
  prompt,
  onToken: (text) => process.stdout.write(text),
  shouldStop: () => stopAfter > 0 && (Date.now() - startedAt) / 1000 >= stopAfter,
});

if (result.stopped) console.log(`\n\n[tap-to-stop — provider freed the model]`);
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n— ${result.seconds || 0}s metered in ${elapsed}s, spent ~${result.spent.toFixed(6)} USDC —`);
process.exit(0);
