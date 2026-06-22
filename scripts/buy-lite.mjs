// Buys one inference from a LITE (browser-extension) node via the coordinator's
// job queue. Unlike the native /v1/sessions flow, the worker isn't reachable
// directly — so payment settles through the coordinator, straight to that job's
// specific worker payout wallet (the coordinator itself never holds the funds).
//
//   node --env-file-if-exists=.env scripts/buy-lite.mjs --prompt "..." [--coordinator http://localhost:19150]

import { config } from "../src/config.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const coordinator = (arg("coordinator", "http://localhost:19150")).replace(/\/$/, "");
const prompt = arg("prompt", "Say hello in five words.");
const maxTokens = Number(arg("max-tokens", "80"));

const log = (s) => console.log(`\x1b[2m[buy-lite]\x1b[0m ${s}`);

const key = process.env.BUYER_PRIVATE_KEY;
if (!key) {
  console.error("Set BUYER_PRIVATE_KEY in .env first.");
  process.exit(1);
}
const { GatewayClient } = await import("@circle-fin/x402-batching/client");
const gateway = new GatewayClient({ chain: config.chain, privateKey: key });

log(`submitting job to ${coordinator} …`);
const { id } = await fetch(`${coordinator}/jobs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt, maxTokens }),
}).then((r) => r.json());
log(`job ${id} queued — waiting for a lite node to claim + run it`);

let status = "pending";
for (let i = 0; i < 120 && status !== "done"; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const job = await fetch(`${coordinator}/jobs/${id}`).then((r) => r.json());
  status = job.status;
  if (status === "claimed" && i % 4 === 0) log(`claimed by ${job.workerName ?? "a worker"} — running…`);
}
if (status !== "done") {
  console.error("timed out waiting for a worker to finish the job.");
  process.exit(1);
}

log(`job done — paying for it (real USDC, settled on Arc)…`);
const payRes = await gateway.pay(`${coordinator}/jobs/${id}/pay`, { method: "POST" });
const body = payRes?.data ?? payRes?.body ?? payRes;

console.log(`\n> ${prompt}\n`);
console.log(body.output);
console.log(`\npaid ${body.paidUsdc} USDC · tx ${body.txHash ?? "?"} · ${config.arc.explorer}/tx/${body.txHash ?? ""}`);
process.exit(0);
