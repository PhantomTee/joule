// Traction generator: runs several concurrent buyer agents that continuously buy
// paid inference from the provider, producing sustained, visible volume (watch the
// provider dashboard climb) and accruing real seller earnings on Arc.
//
//   node --env-file-if-exists=.env scripts/seed-traffic.mjs [--workers 3] [--duration 90] [--deposit 2]

import { config } from "../src/config.js";
import { makeGateway, runSession } from "../src/buyer-core.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const baseUrl = process.env.BASE_URL ?? `http://localhost:${config.port}`;
const workers = Number(arg("workers", "3"));
const duration = Number(arg("duration", "90"));
const deposit = arg("deposit", "2");

const prompts = [
  "Name three primary colors.",
  "What is Circle Arc in one sentence?",
  "Give me one fact about stablecoins.",
  "Summarize x402 in a sentence.",
  "What is a nanopayment?",
  "List two uses for idle GPUs.",
  "Define settlement finality briefly.",
  "One sentence on AI agents paying for compute.",
];
const pick = () => prompts[Math.floor(Math.random() * prompts.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One GatewayClient per worker — sharing a single client across concurrent
// pay() calls races on its internal signing state and fails ~half the requests.
const gateways = [];
for (let i = 0; i < workers; i++) gateways.push(await makeGateway());
console.log(`Depositing ${deposit} USDC into Gateway Wallet…`);
await gateways[0].deposit(deposit);

const stats = { sessions: 0, ticks: 0, spent: 0, errors: 0 };
const endAt = Date.now() + duration * 1000;

async function worker(id) {
  const gateway = gateways[id];
  while (Date.now() < endAt) {
    try {
      const r = await runSession({
        gateway,
        baseUrl,
        prompt: pick(),
        onTick: () => stats.ticks++,
      });
      stats.sessions++;
      stats.spent += r.spent || 0;
      if (r.error) stats.errors++;
    } catch {
      stats.errors++;
    }
    await sleep(200 + Math.random() * 400);
  }
}

const reporter = setInterval(() => {
  const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
  console.log(`  sessions ${stats.sessions} · paid pulls ${stats.ticks} · spent ${stats.spent.toFixed(6)} USDC · ${left}s left`);
}, 5000);

console.log(`Seeding ${workers} concurrent buyers for ${duration}s against ${baseUrl}\n`);
await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));
clearInterval(reporter);

console.log(`\nDone. ${stats.sessions} sessions, ${stats.ticks} paid pulls, ${stats.spent.toFixed(6)} USDC spent, ${stats.errors} errors.`);
process.exit(0);
