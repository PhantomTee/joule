// Reasoning buyer agent. Unlike the scripted buyer (which pays every tick until
// the stream ends), this agent makes decisions:
//   1. picks a provider within budget,
//   2. after each paid second, JUDGES the answer-so-far with a model and decides
//      CONTINUE / STOP — so stopping is the agent's own call, not a timer,
//   3. enforces a hard USDC budget.
// It narrates every decision. The judgment runs on local compute (unpaid); the
// agent only pays for the work it chooses to buy.
//
//   node src/agent-buyer.js --goal "Explain Arc in 3 sentences" --budget 0.005

import { config } from "./config.js";
import { makeGateway, runSession } from "./buyer-core.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const goal = arg("goal", "Explain what Circle Arc is in three sentences.");
const budget = Number(arg("budget", "0.005"));
const maxPrice = Number(arg("max-price", "0.0005")); // most the agent will pay per second
const deposit = arg("deposit", "1");

const log = (s) => console.log(`\x1b[2m[agent]\x1b[0m ${s}`);

// ── Provider discovery ────────────────────────────────────────────────────────
// Priority order:
//   1. On-chain registry via /api/providers (if COORDINATOR_URL points to a Joule node)
//   2. Coordinator /nodes list (fast, always fresh)
//   3. Explicit PROVIDERS env var or BASE_URL (legacy / solo-node mode)

async function discoverFromRegistry(coordUrl) {
  try {
    const data = await fetch(`${coordUrl}/nodes`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
    return (data.nodes || [])
      .filter((n) => n.url && n.pricePerSecond != null)
      .map((n) => ({
        name:   n.name || "node",
        url:    n.url,
        rate:   n.pricePerSecond,
        reason: n.activeSessions > 0 ? `${n.activeSessions} session(s) in flight` : "open",
        model:  n.model,
        score:  (1 / (n.pricePerSecond || 1)),  // cheapest = highest score by default
      }))
      .sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}

async function discoverFromCard(urlBase) {
  try {
    const card = await fetch(`${urlBase}/agent-card`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
    return { name: card.name, url: urlBase, rate: card.payment.perSecondUsdc, reason: card.payment.reason, model: card.model };
  } catch {
    return null;
  }
}

const coordUrl = process.env.COORDINATOR_URL || config.defaultCoordinatorUrl;
const knownUrls = (process.env.PROVIDERS ?? process.env.BASE_URL ?? `http://localhost:${config.port}`)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Judge the answer-so-far with the local model (free, not through the paywall).
async function judge(question, answer) {
  const prompt =
    `You are deciding whether to keep paying for more of an answer.\n` +
    `QUESTION: ${question}\nANSWER SO FAR: ${answer}\n\n` +
    `If the answer already addresses the question, reply STOP. If it is clearly ` +
    `unfinished, reply CONTINUE. Reply with one word only: STOP or CONTINUE.`;
  try {
    const res = await fetch(`${config.inferenceBase}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.inferenceApiKey ? { Authorization: `Bearer ${config.inferenceApiKey}` } : {}) },
      body: JSON.stringify({ model: config.model, messages: [{ role: "user", content: prompt }], max_tokens: 3, temperature: 0, stream: false }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    const out = (data.choices?.[0]?.message?.content || "").toUpperCase();
    if (out.includes("STOP")) return { stop: true, reason: "model judged the answer complete" };
    if (out.includes("CONTINUE")) return { stop: false, reason: "model wants more" };
  } catch {}
  // Heuristic backstop if the judge is unavailable/unclear: complete sentence + enough content.
  const looksComplete = /[.!?]\s*$/.test(answer.trim()) && answer.trim().length > 40;
  return { stop: looksComplete, reason: looksComplete ? "answer reads complete (heuristic)" : "still forming (heuristic)" };
}

// --- discover providers and negotiate (A2A) ---
log(`goal: "${goal}"`);
log(`budget: ${budget.toFixed(6)} USDC  ·  won't pay more than ${maxPrice}/sec`);

// Try coordinator-based discovery first (dynamic, ranks by price); fall back to explicit URLs
let cards = await discoverFromRegistry(coordUrl);
if (!cards.length) {
  log(`coordinator at ${coordUrl} returned no nodes — falling back to explicit URLs`);
  cards = (await Promise.all(knownUrls.map(discoverFromCard))).filter(Boolean);
} else {
  log(`discovered ${cards.length} node(s) from coordinator`);
}
if (!cards.length) {
  log("no providers reachable — not buying.");
  process.exit(0);
}
for (const c of cards) log(`discovered ${c.name} @ ${c.rate}/sec (${c.reason})`);

// Accept only providers quoting at or below the agent's max price; pick the cheapest.
const acceptable = cards.filter((c) => c.rate <= maxPrice).sort((a, b) => a.rate - b.rate);
if (!acceptable.length) {
  const best = cards.sort((a, b) => a.rate - b.rate)[0];
  log(`cheapest quote ${best.rate}/sec is above my max ${maxPrice}/sec → walking away (no deal).`);
  process.exit(0);
}
const provider = acceptable[0];
const tickCost = provider.rate * config.tickSeconds;
log(`deal: ${provider.name} @ ${provider.rate}/sec accepted (≤ ${maxPrice}) · ~${Math.floor(budget / tickCost)}s of runway`);

const gateway = await makeGateway();
await gateway.deposit(deposit);

let answer = "";
let spent = 0;
let stopReason = "stream ended on its own";

console.log(`\n\x1b[1m> ${goal}\x1b[0m\n`);

const result = await runSession({
  gateway,
  baseUrl: provider.url,
  prompt: goal,
  onToken: (t, s) => {
    answer += t;
    spent = s;
    process.stdout.write(t);
  },
  onTick: ({ spent: s }) => {
    spent = s;
  },
  shouldStop: async () => {
    if (spent + tickCost > budget) {
      stopReason = "hit budget cap";
      console.log("");
      log(`spent ${spent.toFixed(6)} — one more second would exceed budget → STOP`);
      return true;
    }
    if (!answer.trim()) return false;
    const verdict = await judge(goal, answer);
    console.log("");
    log(`spent ${spent.toFixed(6)} · decision: ${verdict.stop ? "STOP" : "CONTINUE"} (${verdict.reason})`);
    if (verdict.stop) stopReason = verdict.reason;
    return verdict.stop;
  },
});

const secs = result.seconds || 0;
log(`stopped: ${stopReason}`);
log(`bought ${secs}s of inference for ${(result.spent ?? spent).toFixed(6)} USDC (budget was ${budget.toFixed(6)})`);
process.exit(0);
