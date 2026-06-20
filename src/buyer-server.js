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

function startRun(prompt) {
  const id = randomUUID();
  const run = { id, subs: new Set(), stop: false, buffer: [], spent: 0, seconds: 0, status: "opening", answer: "" };
  runs.set(id, run);

  const emit = (ev) => {
    run.buffer.push(ev);
    if (run.buffer.length > 1000) run.buffer.shift();
    for (const res of run.subs) writeEvent(res, ev);
  };

  runSession({
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
    shouldStop: () => run.stop,
  })
    .then((r) => emit({ type: "end", ...r }))
    .catch((e) => emit({ type: "end", error: String(e?.message ?? e) }));

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
