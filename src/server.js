// HTTP sidecar: x402-gated, pay-per-second streaming inference over local Ollama.
//
//   POST /v1/sessions            open a session (pay the opening tick) -> { sessionId, ... }
//   POST /v1/sessions/:id/pull   pay one tick -> tokens streamed this interval
//   POST /v1/sessions/:id/stop   tap-to-stop (no charge) -> final state
//   GET  /healthz                ollama/idle/gpu liveness
//   GET  /stats                  earnings + system snapshot + active sessions
//
// Every paid call settles real test-USDC on Arc via @circle-fin/x402-batching.

import http from "node:http";
import { config, usdcToAtomic } from "./config.js";
import { charge, paymentRequiredHeader } from "./payment.js";
import { SessionManager } from "./session.js";
import { Earnings } from "./earnings.js";
import * as sysmon from "./sysmon.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import { NODE_CONSOLE_HTML } from "./node-console.js";
import { TRY_HTML } from "./try-page.js";
import { PricingAgent } from "./pricing.js";
import { streamChat } from "./inference.js";
import { listProviders, getProvider } from "./registry.js";
import { createAttestation, encodeAttestationHeader } from "./attestation.js";

// Free "try it, no wallet" demo — capped + lightly rate-limited so it can't be abused.
let demoInFlight = 0;
let lastDemoAt = 0;
const DEMO_MAX_TOKENS = 80;

// Lazy seller-side GatewayClient, used to read this node's accrued earnings.
let sellerGw = null;
async function sellerGatewayBalance() {
  if (!process.env.SELLER_PRIVATE_KEY) throw new Error("SELLER_PRIVATE_KEY not set");
  if (!sellerGw) {
    const { GatewayClient } = await import("@circle-fin/x402-batching/client");
    sellerGw = new GatewayClient({ chain: config.chain, privateKey: process.env.SELLER_PRIVATE_KEY });
  }
  const b = await sellerGw.getBalances();
  return {
    availableUsdc: b?.gateway?.formattedAvailable ?? "0",
    totalUsdc: b?.gateway?.formattedTotal ?? "0",
    onchainUsdc: b?.wallet?.formatted ?? b?.wallet?.formattedBalance ?? "0",
  };
}

const tickAtomic = () =>
  Math.max(usdcToAtomic(config.pricePerSecondUsdc * config.tickSeconds), usdcToAtomic(config.minChargeUsdc));
const floorAtomic = () => usdcToAtomic(config.minChargeUsdc);
const atomicPerSecond = () => usdcToAtomic(config.pricePerSecondUsdc) || 1;

function send(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
  res.end(body);
}

function payment402(res, requirements, endpoint, reason) {
  send(
    res,
    402,
    { error: "payment_required", reason: reason ?? null },
    { "PAYMENT-REQUIRED": paymentRequiredHeader(requirements, endpoint) },
  );
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

// Settle a specific amount; returns { ok, result } where on 402 the caller has
// already responded. The amount must be identical across the client's unpaid
// request and its signed retry, so callers freeze it (see the pull route).
async function settleAmount(req, res, endpoint, amountAtomic) {
  const signatureHeader = req.headers["payment-signature"];
  const result = await charge({ signatureHeader, amountAtomic, endpoint });
  if (!result.settled) {
    payment402(res, result.requirements, endpoint, result.reason);
    return { ok: false };
  }
  return { ok: true, result };
}

export function createServer({ idleMonitor } = {}) {
  const earnings = new Earnings();
  const sessions = new SessionManager();
  const pricing = new PricingAgent();

  // Live demand state the pricing agent reasons over.
  const demandState = () => ({
    activeSessions: sessions.sessions.size,
    idleSeconds: idleMonitor?.seconds ?? 0,
  });
  const liveQuote = () => pricing.quote(demandState());

  function agentCard() {
    const q = liveQuote();
    return {
      protocolVersion: "0.2",
      name: "Joule node",
      description:
        "Pay-per-second LLM inference on idle compute, settled in USDC on Arc via x402 nanopayments.",
      url: `http://localhost:${config.port}`,
      provider: { wallet: config.sellerAddress, network: config.arc.network },
      model: config.model,
      skills: [
        { id: "inference", name: "streaming chat completion", tags: ["llm", "inference", "pay-per-second"] },
      ],
      capabilities: { streaming: true, payPerSecond: true, tapToStop: true, dynamicPricing: true },
      payment: {
        scheme: "x402",
        asset: config.arc.usdc,
        network: config.arc.network,
        perSecondUsdc: q.price,
        baseUsdc: q.base,
        multiplier: q.multiplier,
        reason: q.reason,
      },
      endpoints: {
        open: "/v1/sessions",
        pull: "/v1/sessions/:id/pull",
        stop: "/v1/sessions/:id/stop",
      },
    };
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // --- A2A discovery: the provider's agent card with its live price ---
    if (req.method === "GET" && (path === "/agent-card" || path === "/.well-known/agent-card.json")) {
      return send(res, 200, agentCard());
    }

    // --- dashboard (free) ---
    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(DASHBOARD_HTML);
    }

    // --- "try it, no wallet" demo: a free, capped taste of the inference ---
    if (req.method === "GET" && path === "/try") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(TRY_HTML);
    }
    if (req.method === "POST" && path === "/v1/demo") {
      if (demoInFlight >= 2 || Date.now() - lastDemoAt < 1200) {
        return send(res, 429, { error: "demo_busy", reason: "free demo is rate-limited — try again in a moment, or run a real paid session" });
      }
      const body = await readJson(req);
      const prompt = (body && (body.prompt || body.messages?.[0]?.content)) || "Say hello in one sentence.";
      demoInFlight++;
      lastDemoAt = Date.now();
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
      try {
        await streamChat({
          body: { messages: [{ role: "user", content: String(prompt).slice(0, 600) }], max_tokens: DEMO_MAX_TOKENS },
          onToken: (t) => res.write(t),
        });
      } catch (e) {
        res.write(`\n[demo unavailable: ${e.message}]`);
      } finally {
        demoInFlight--;
        res.end();
      }
      return;
    }

    // --- DePIN operator console (free) ---
    if (req.method === "GET" && path === "/node") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(NODE_CONSOLE_HTML);
    }
    if (req.method === "GET" && path === "/node-info") {
      return send(res, 200, {
        sellerAddress: config.sellerAddress,
        model: config.model,
        network: config.arc.network,
        chainId: 5042002,
        rpc: "https://rpc.testnet.arc.network",
        usdc: config.arc.usdc,
        explorer: config.arc.explorer,
        pricePerSecond: config.pricePerSecondUsdc,
      });
    }
    if (req.method === "GET" && path === "/gateway-balance") {
      try {
        return send(res, 200, await sellerGatewayBalance());
      } catch (err) {
        return send(res, 503, { error: "unavailable", message: err.message });
      }
    }

    // --- liveness / stats (free) ---
    if (req.method === "GET" && path === "/healthz") {
      const [snap] = await Promise.all([sysmon.snapshot()]);
      return send(res, 200, {
        ok: true,
        idleSeconds: idleMonitor?.seconds ?? null,
        gpu: snap.gpu,
        model: config.model,
        inferenceBase: config.inferenceBase,
        pricePerSecond: liveQuote().price,
        paymentMode: "circle",
      });
    }
    if (req.method === "GET" && path === "/stats") {
      const [summary, snap] = await Promise.all([earnings.summary(), sysmon.snapshot()]);
      const q = liveQuote();
      return send(res, 200, {
        earnings: summary,
        system: snap,
        activeSessions: sessions.sessions.size,
        pricing: {
          usdcPerSecond: q.price,
          baseUsdc: q.base,
          multiplier: q.multiplier,
          reason: q.reason,
          tickSeconds: config.tickSeconds,
        },
      });
    }

    // --- open session ---
    if (req.method === "POST" && path === "/v1/sessions") {
      if (config.requireIdle && (idleMonitor?.seconds ?? 0) < config.idleThresholdSeconds) {
        return send(res, 503, { error: "provider_busy", reason: "machine_not_idle" });
      }
      const endpoint = "/v1/sessions";
      // The pricing agent sets the per-second price for this session, by demand.
      const quote = liveQuote();
      const openAtomic = Math.max(usdcToAtomic(quote.price * config.tickSeconds), floorAtomic());
      const settled = await settleAmount(req, res, endpoint, openAtomic);
      if (!settled.ok) return;

      const body = await readJson(req);
      if (!body || !Array.isArray(body.messages)) {
        return send(res, 400, { error: "bad_request", reason: "messages[] required" });
      }

      const session = sessions.create({
        model: config.model,
        body,
        payer: settled.result.payer,
        pricePerSecondUsdc: quote.price,
      });
      await earnings.record({
        sessionId: session.id,
        model: config.model,
        payer: settled.result.payer,
        seconds: config.tickSeconds,
        amountAtomic: settled.result.amountAtomic,
        gatewayTx: settled.result.transaction,
      });

      return send(res, 200, {
        sessionId: session.id,
        tokens: session.drainBuffer(),
        receipt: { transaction: settled.result.transaction, amountUsdc: settled.result.amountAtomic / 1e6 },
        state: session.publicState(),
      });
    }

    // --- pull / stop on an existing session ---
    const m = path.match(/^\/v1\/sessions\/([^/]+)\/(pull|stop)$/);
    if (req.method === "POST" && m) {
      const [, id, action] = m;
      const session = sessions.get(id);
      if (!session) return send(res, 404, { error: "no_such_session" });

      if (action === "stop") {
        session.stop("buyer_stopped");
        // Attest the accumulated output at tap-to-stop (best-effort, non-blocking)
        const stopAttestation = await createAttestation({
          model:     session.model,
          prompt:    session._prompt || "",
          output:    session.fullOutput,
          sessionId: session.id,
        }).catch(() => null);
        const extraHeaders = stopAttestation
          ? { "x-inference-attestation": encodeAttestationHeader(stopAttestation) }
          : {};
        return send(res, 200, { stopped: true, state: session.publicState() }, extraHeaders);
      }

      // pull — pay for the SECONDS of generation since the last pull (so a buyer
      // who pulls slowly pays for the time the model actually ran). The price is
      // frozen per pull so the unpaid 402 and the signed retry quote the same amount.
      const endpoint = `/v1/sessions/${id}/pull`;
      if (session.pendingQuoteAtomic == null) {
        session.pendingQuoteAtomic = Math.max(session.meter.pendingIntervalAtomic(), floorAtomic());
      }
      const amt = session.pendingQuoteAtomic;
      const settled = await settleAmount(req, res, endpoint, amt);
      if (!settled.ok) return;

      sessions.touch(id);
      session.meter.commitInterval();
      session.pendingQuoteAtomic = null;
      const billedSeconds = Number((amt / atomicPerSecond()).toFixed(3));
      await earnings.record({
        sessionId: id,
        model: session.model,
        payer: settled.result.payer,
        seconds: billedSeconds,
        outputTokens: session.meter.outputTokens,
        amountAtomic: settled.result.amountAtomic,
        gatewayTx: settled.result.transaction,
      });

      const tokens = session.drainBuffer();
      const done = session.isComplete() || session.status !== "streaming";
      if (done && session.isComplete()) sessions.remove(id);

      // On the final pull, sign the complete output so the buyer can verify it.
      let attestationHeader = {};
      if (done) {
        const att = await createAttestation({
          model:     session.model,
          prompt:    session._prompt || "",
          output:    session.fullOutput,
          sessionId: id,
        }).catch(() => null);
        if (att) attestationHeader = { "x-inference-attestation": encodeAttestationHeader(att) };
      }

      return send(res, 200, {
        tokens,
        done,
        receipt: { transaction: settled.result.transaction, amountUsdc: settled.result.amountAtomic / 1e6 },
        state: session.publicState(),
      }, attestationHeader);
    }

    // ── Provider discovery API (Phase 2) ─────────────────────────────────────
    // These endpoints work with or without an on-chain registry — they fall back
    // to the coordinator's live node list when REGISTRY_ADDRESS is not set.

    if (req.method === "GET" && path === "/api/providers") {
      const sortBy = url.searchParams.get("sortBy") || "earnings";
      const limit  = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
      try {
        if (process.env.REGISTRY_ADDRESS) {
          const providers = await listProviders({ sortBy, limit });
          return send(res, 200, { providers, source: "onchain" });
        }
        // Fall back: proxy the coordinator's /nodes list
        const coord = process.env.COORDINATOR_URL || config.defaultCoordinatorUrl;
        const data  = await fetch(`${coord}/nodes`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
        return send(res, 200, { providers: data.nodes || [], source: "coordinator" });
      } catch (err) {
        return send(res, 503, { error: "discovery_unavailable", message: err.message });
      }
    }

    if (req.method === "GET" && path.startsWith("/api/providers/")) {
      const seg = path.slice("/api/providers/".length);
      if (!seg || isNaN(Number(seg))) return send(res, 400, { error: "invalid provider id" });
      try {
        if (!process.env.REGISTRY_ADDRESS) return send(res, 503, { error: "REGISTRY_ADDRESS not set" });
        const provider = await getProvider(Number(seg));
        if (!provider) return send(res, 404, { error: "not_found" });
        return send(res, 200, { provider });
      } catch (err) {
        return send(res, 500, { error: "registry_error", message: err.message });
      }
    }

    if (req.method === "GET" && path === "/api/market-stats") {
      try {
        const [summary, snap] = await Promise.all([earnings.summary(), sysmon.snapshot()]);
        const coord = process.env.COORDINATOR_URL || config.defaultCoordinatorUrl;
        let networkStats = { totalProviders: 0, avgPrice: 0 };
        try {
          const d = await fetch(`${coord}/nodes`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json());
          const nodes = d.nodes || [];
          const prices = nodes.map((n) => n.pricePerSecond).filter(Boolean);
          networkStats = {
            totalProviders: nodes.length,
            avgPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
            totalEarnings: nodes.reduce((s, n) => s + Number(n.earnedUsdc || 0), 0),
          };
        } catch {}
        return send(res, 200, {
          thisNode:     summary,
          system:       snap,
          network:      networkStats,
          onchain:      !!process.env.REGISTRY_ADDRESS,
        });
      } catch (err) {
        return send(res, 500, { error: "stats_error", message: err.message });
      }
    }
    // ── /api/providers search ────────────────────────────────────────────────
    if (req.method === "GET" && path === "/api/providers/search") {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      try {
        const coord = process.env.COORDINATOR_URL || config.defaultCoordinatorUrl;
        const data  = await fetch(`${coord}/nodes`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
        const nodes = (data.nodes || []).filter((n) =>
          !q || (n.model || "").toLowerCase().includes(q) || (n.name || "").toLowerCase().includes(q)
        );
        return send(res, 200, { providers: nodes });
      } catch (err) {
        return send(res, 503, { error: "search_unavailable", message: err.message });
      }
    }

    send(res, 404, { error: "not_found" });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[server] error:", err);
      if (!res.headersSent) send(res, 500, { error: "internal", message: err.message });
    });
  });

  server.on("close", () => sessions.shutdown());
  return { server, sessions, earnings };
}
