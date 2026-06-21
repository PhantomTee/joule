// Buyer console server. Holds the buyer's key server-side and drives the paid
// session loop; the browser just sends a prompt and watches tokens + spend stream
// over SSE, and can tap stop. Run: npm run console

import http from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { makeGateway, runSession } from "./buyer-core.js";
import { BUYER_CONSOLE_HTML } from "./buyer-console.js";

const PORT = Number(process.env.BUYER_PORT || 19132);
const baseUrl = process.env.BASE_URL ?? `http://localhost:${config.port}`;
const runs = new Map();

let gateway;
async function init() {
  gateway = await makeGateway();
  try {
    const amount = process.env.DEPOSIT_AMOUNT ?? "1";
    console.log(`Depositing ${amount} USDC into Gateway Wallet…`);
    await gateway.deposit(amount);
  } catch (err) {
    console.warn(`Initial deposit skipped: ${err.message}`);
  }
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return null;
  }
}
const writeEvent = (res, ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);

const BUDGET = Number(process.env.AGENT_BUDGET || 0.01);
const MAX_PRICE = Number(process.env.AGENT_MAX_PRICE || 0.0005);

// Discover the provider's live terms via its A2A agent card.
async function discover() {
  try {
    const card = await fetch(`${baseUrl}/agent-card`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
    return { name: card.name, rate: card.payment?.perSecondUsdc ?? config.pricePerSecondUsdc, reason: card.payment?.reason, model: card.model };
  } catch {
    return null;
  }
}

// Ask the local model whether the answer-so-far is complete (the agent's own judgment).
async function judge(question, answer) {
  try {
    const res = await fetch(`${config.inferenceBase}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.inferenceApiKey ? { Authorization: `Bearer ${config.inferenceApiKey}` } : {}) },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: `QUESTION: ${question}\nANSWER SO FAR: ${answer}\n\nIs the answer complete? Reply one word: STOP or CONTINUE.` }],
        max_tokens: 3, temperature: 0, stream: false,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const out = ((await res.json()).choices?.[0]?.message?.content || "").toUpperCase();
    if (out.includes("STOP")) return { stop: true, reason: "the answer already addresses the question" };
    if (out.includes("CONTINUE")) return { stop: false, reason: "it still looks unfinished" };
  } catch {}
  const done = /[.!?]\s*$/.test(answer.trim()) && answer.trim().length > 40;
  return { stop: done, reason: done ? "it reads complete" : "it's still forming" };
}

function startRun(prompt) {
  const id = randomUUID();
  const run = { id, subs: new Set(), stop: false, buffer: [], spent: 0, seconds: 0, status: "opening", answer: "" };
  runs.set(id, run);

  const emit = (ev) => {
    run.buffer.push(ev);
    if (run.buffer.length > 1000) run.buffer.shift();
    for (const res of run.subs) writeEvent(res, ev);
  };
  const think = (text) => emit({ type: "thought", text });

  (async () => {
    think(`New request. I'll buy only as much of the answer as I actually need.`);
    think(`Discovering a provider…`);
    const card = await discover();
    if (!card) {
      think(`No provider is reachable — I won't spend anything. Aborting.`);
      return emit({ type: "end", error: "no provider reachable" });
    }
    const tickCost = card.rate * config.tickSeconds;
    think(`Found ${card.name} quoting ${card.rate} USDC/sec (${card.reason || "base rate"}), running ${card.model}.`);
    if (card.rate > MAX_PRICE) {
      think(`That's above my ${MAX_PRICE}/sec limit → walking away. No deal.`);
      return emit({ type: "end", walked: true });
    }
    think(`Within my ${MAX_PRICE}/sec limit and ${BUDGET} USDC budget (~${Math.floor(BUDGET / tickCost)}s of runway). Deal — opening a paid session.`);

    await runSession({
      gateway,
      baseUrl,
      prompt,
      onToken: (text, spent) => {
        run.answer += text;
        run.spent = spent;
        emit({ type: "token", text, spent });
      },
      onTick: ({ spent, seconds }) => {
        run.spent = spent;
        run.seconds = seconds;
        emit({ type: "tick", spent, seconds });
      },
      onStatus: (s) => {
        run.status = s.phase;
        if (s.spent != null) run.spent = s.spent;
        if (s.seconds != null) run.seconds = s.seconds;
        emit({ type: "status", ...s });
      },
      shouldStop: async () => {
        if (run.stop) {
          think(`You tapped stop — halting and settling only the ${run.seconds || 0}s I used.`);
          return true;
        }
        if (run.spent + tickCost > BUDGET) {
          think(`Budget reached (${run.spent.toFixed(6)}/${BUDGET} USDC) — stopping here.`);
          return true;
        }
        if (!run.answer.trim()) return false;
        const v = await judge(prompt, run.answer);
        think(v.stop ? `Checked the answer — ${v.reason}. Stopping; no reason to keep paying.` : `Checked the answer — ${v.reason}. Paying for another second.`);
        return v.stop;
      },
    })
      .then((r) => emit({ type: "end", ...r }))
      .catch((e) => emit({ type: "end", error: String(e?.message ?? e) }));
  })();

  return id;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(BUYER_CONSOLE_HTML);
  }

  if (req.method === "GET" && path === "/api/state") {
    let balanceUsdc = null;
    try {
      const b = await gateway.getBalances();
      balanceUsdc = b?.gateway?.formattedAvailable ?? null;
    } catch {}
    return send(res, 200, {
      providerBase: baseUrl,
      balanceUsdc,
      pricePerSecond: config.pricePerSecondUsdc,
      tickSeconds: config.tickSeconds,
    });
  }

  if (req.method === "POST" && path === "/api/run") {
    const body = await readJson(req);
    const prompt = (body?.prompt || "").trim();
    if (!prompt) return send(res, 400, { error: "prompt required" });
    return send(res, 200, { runId: startRun(prompt) });
  }

  const ev = path.match(/^\/api\/events\/([^/]+)$/);
  if (req.method === "GET" && ev) {
    const run = runs.get(ev[1]);
    if (!run) return send(res, 404, { error: "no such run" });
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    for (const past of run.buffer) writeEvent(res, past); // catch up
    run.subs.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(ping);
      run.subs.delete(res);
    });
    return;
  }

  const st = path.match(/^\/api\/stop\/([^/]+)$/);
  if (req.method === "POST" && st) {
    const run = runs.get(st[1]);
    if (!run) return send(res, 404, { error: "no such run" });
    run.stop = true;
    return send(res, 200, { stopped: true });
  }

  send(res, 404, { error: "not_found" });
});

await init();
server.listen(PORT, () => {
  console.log(`Buyer console on http://localhost:${PORT}  (provider: ${baseUrl})`);
});
