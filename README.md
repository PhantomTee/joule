# Joule — an agent-to-agent market for inference by the second

> Lepton Agents Hackathon (Canteen × Circle) · **RFB 4: Streaming & Continuous Payments** (+ RFB 2)

Spare GPU/CPU becomes a paid inference provider. A **buyer agent** discovers providers, judges the price,
streams a completion, and **pays per second in test-USDC on [Arc](https://docs.arc.io)** via Circle x402
nanopayments — deciding for itself when the answer is good enough and stopping. A **provider agent** sets
its own price by demand. Both sides are autonomous: a real agent-to-agent market.

Pure Node (≥22), no framework. Real Circle settlement — no mock.

**Try it in 5 seconds, no wallet:** with a node running, open [`/try`](http://localhost:19131/try) or:
```bash
curl -sN -X POST http://localhost:19131/v1/demo -H 'Content-Type: application/json' -d '{"prompt":"What is x402?"}'
```

---

## Why Joule is different

Pay-per-inference is a crowded idea — so here's the precise lane Joule occupies versus its neighbors:

| | What it really is | Compute | Rail |
|---|---|---|---|
| Hosted APIs (OpenAI/Anthropic) | accounts, cards, API keys | their datacenters | fiat/cards |
| **InferPay** | x402 **proxy that resells hosted LLMs** | someone else's API | Circle/x402/Arc |
| **darkbloom** | private inference + Apple attestation | idle **Apple Silicon** | its own coordinator |
| **wavefy** | one model **sharded** across P2P devices | many devices | Aptos |
| **Joule** | **your own idle hardware** serves the model | idle GPU/CPU you own | Circle/x402/Arc |

Joule is the only one combining **real idle local compute** (not a proxy), **per-second metering + tap-to-stop**
(not per-call), **two autonomous agents with visible reasoning**, and **Circle x402 on Arc**. The distinction
from InferPay matters most: InferPay is Stripe-for-OpenAI; **Joule sells the operator's actual hardware** —
that's the DePIN thesis. The inference happens on *your* machine, and you keep the revenue.

---

## Architecture

```
  ┌─────────────────────────────────────────────────┐
  │                 Arc Testnet (chainId 5042002)    │
  │  InferenceProviderRegistry.sol                   │
  │  (reputation, earnings, uptime, latency EMA)     │
  └────────────────┬────────────────────────────────┘
                   │ viem read/write (hourly)
                   │
  ┌────────────────▼────────────────────────────────┐
  │              Joule Provider Node                 │
  │                                                  │
  │  ┌──────────────┐   ┌──────────────────────────┐ │
  │  │ PricingAgent │   │  InferenceProviderReg.   │ │
  │  │  6 factors:  │   │  registry-reporter.js    │ │
  │  │  demand/idle │   │  hourly metric flush     │ │
  │  │  time-of-day │   └──────────────────────────┘ │
  │  │  GPU temp    │                                 │
  │  │  model size  │   ┌──────────────────────────┐ │
  │  │  queue trend │   │  attestation.js          │ │
  │  └──────┬───────┘   │  EIP-191 sign per session│ │
  │         │           └──────────────────────────┘ │
  │  ┌──────▼───────────────────────────────────────┐ │
  │  │          server.js (HTTP sidecar)            │ │
  │  │  POST /v1/sessions        (open + pay)       │ │
  │  │  POST /v1/sessions/:id/pull (pay + tokens)   │ │
  │  │  POST /v1/sessions/:id/stop (tap-to-stop)    │ │
  │  │  GET  /metrics            (Prometheus)       │ │
  │  │  GET  /api/providers      (discovery)        │ │
  │  └──────────────┬───────────────────────────────┘ │
  │                 │ x402 verify+settle (3x retry)    │
  └─────────────────│──────────────────────────────────┘
                    │
  ┌─────────────────▼──────────────────────────────────┐
  │       Circle Gateway (BatchFacilitatorClient)      │
  │       Arc USDC: 0x3600…0000                        │
  │       GatewayWallet: 0x0077…19B9                   │
  └─────────────────┬──────────────────────────────────┘
                    │ settle on-chain
                    ▼
        Arc Testnet (sub-500ms finality)
                    ▲
  ┌─────────────────│──────────────────────────────────┐
  │            Buyer Agent (agent-buyer.js)            │
  │  1. Discover providers → agent cards               │
  │  2. Compare prices → accept or walk away           │
  │  3. Pay per second via GatewayClient               │
  │  4. Verify attestation on final pull               │
  │  5. Judge answer each tick → tap to stop           │
  └────────────────────────────────────────────────────┘
```

---

## The two agents

- **Provider pricing agent** ([src/pricing.js](src/pricing.js)) — quotes a per-second price that **surges when
  busy** and **discounts when the machine is idle**. Advertised live on its A2A agent card.
- **Buyer agent** ([src/agent-buyer.js](src/agent-buyer.js)) — discovers providers via their agent cards,
  **walks away if the price is over its max**, otherwise streams and **judges the answer each second with a
  model**, stopping on its own (or at its budget). Every decision is narrated.

```bash
npm run agent -- --goal "Name two colors." --budget 0.003 --max-price 0.0005
#  discovered idle-compute node @ 0.00014/sec (machine idle → 0.7x discount)
#  deal accepted (≤ 0.0005) · streams, judges, stops on its own
npm run agent -- --goal "..." --max-price 0.0001
#  cheapest quote 0.0003/sec is above my max → walking away (no deal)
```

---

## How payment works

Real x402 settlement is request-scoped, so continuous per-second billing holds the model stream
**server-side** while the buyer pays per interval:

1. `GET /agent-card` — discover the provider + its **live per-second price**.
2. `POST /v1/sessions` — buyer pays the opening second; price is **locked for the session**; provider starts
   streaming server-side and returns a `sessionId`.
3. `POST /v1/sessions/:id/pull` — settles the **seconds elapsed since the last pull** (so slow pullers can't
   underpay) and returns the tokens from that interval. Repeat until done.
4. `POST /v1/sessions/:id/stop` — **tap to stop**: stop paying and the provider frees the model (a reaper
   also reclaims any session whose buyer goes silent for `PULL_GRACE_SECONDS`).

Settlement runs through `@circle-fin/x402-batching` on Arc testnet (`eip155:5042002`, USDC `0x3600…0000`,
GatewayWallet `0x0077…19B9`). Sub-cent payments are economical because Circle Gateway batches them
off-chain into single on-chain claims.

**Settlement hardening**: verify is attempted once (invalid signature = hard 402). Settle retries up to
3 times with exponential backoff (100 → 400 → 1600 ms) on transient Gateway/RPC failures. Definitive
rejections (`insufficient_funds`, `already_settled`) skip retries immediately.

---

## Dynamic pricing

The provider's [`PricingAgent`](src/pricing.js) computes a per-second price from 6 multiplicative factors:

| # | Factor | When | Effect |
|---|---|---|---|
| 1 | Demand surge | each active session | `+50%` per concurrent session |
| 2 | Idle discount | machine idle & no sessions | `−30%` (attracts first job) |
| 3 | Time of day | UTC 09–17 (peak) | `+20%` / `−15%` off-peak |
| 4 | GPU temperature | >80°C hot / <30°C cold | `+50%` / `−30%` |
| 5 | Model size | 0.5B → 70B | `0.7×` → `4.0×` multiplier |
| 6 | Predictive surge | queue growing last 30s | up to `+25%` |

Price is clamped to `[base × 0.40, base × 6.00]` and the full reasoning is narrated in every response:

```json
{
  "pricePerSecondUsdc": 0.00042,
  "reason": "2 session(s) →2.00x · peak UTC 09–17 +20% · GPU 78°C warm +20% · M model ×2.0",
  "breakdown": {
    "activeSessions": 2,
    "gpuFactor": "GPU 78°C warm +20%",
    "todFactor": "peak UTC 09–17 +20%",
    "modelFactor": "M model ×2.0",
    "trendDelta": 0.1
  }
}
```

---

## On-chain reputation registry

[`InferenceProviderRegistry.sol`](contracts/InferenceProviderRegistry.sol) is deployed at
**`0x3daf601556f6c095c632216ead1306574d423abf`** on Arc Testnet.

Providers register with their wallet address, model name, and base price. After each session the node
reports metrics on-chain (with 5-retry exponential backoff):

| Field | Update rule |
|---|---|
| `avgLatencyMs` | EMA: `(prev × 7 + new) / 8` |
| `errorRatePpm` | `errors × 1,000,000 / totalSessions` |
| `uptimePct` | `activeSeconds / uptimeWindow × 100` |
| `totalSessions` / `totalRevenue` | cumulative counters |

```bash
npm run contracts:compile   # compile InferenceProviderRegistry.sol
npm run contracts:deploy    # deploy to Arc testnet (SELLER_PRIVATE_KEY in .env)
npm run provider:register   # register this node (appends PROVIDER_ID to .env)
```

---

## Cryptographic attestation

Every session produces an EIP-191 signature over `model || sha256(prompt) || sha256(output) || timestamp`
signed with the provider's `SELLER_PRIVATE_KEY`. The attestation is returned in the
`x-inference-attestation` header (base64-encoded JSON) on every final pull and tap-to-stop.

Buyers verify automatically via [`verifyAttestation()`](src/attestation.js):

```js
// what the buyer verifies (buyer-core.js)
const attestation = parseAttestationHeader(response.headers.get("x-inference-attestation"));
const result = await verifyAttestation(attestation, prompt, fullOutput, providerAddress);
// result: { ok: true, reason: "verified" } — or { ok: false, reason: "output hash mismatch" }
```

Attestations are appended to `data/attestations.jsonl`; buyer verifications to `data/verifications.jsonl`.

---

## Observability

Prometheus metrics at **`GET /metrics`** (scrape with Prometheus or Grafana):

| Metric | Type | Labels | Description |
|---|---|---|---|
| `joule_sessions_total` | counter | `outcome` (opened/completed) | Sessions by outcome |
| `joule_provider_seconds_billed_total` | counter | — | Cumulative inference-seconds billed |
| `joule_provider_usdc_earned_total` | counter | — | Cumulative USDC earned |
| `joule_session_duration_seconds` | histogram | — | Per-pull billed seconds |
| `joule_payment_settlement_latency_ms` | histogram | — | x402 verify+settle latency |
| `joule_x402_verify_errors_total` | counter | — | Signature verify failures |
| `joule_x402_retries_total` | counter | — | Settlement retry attempts |

Structured JSON logs to stderr (pino-compatible format). Set `LOG_LEVEL=debug` for verbose output.

---

## API reference

### Provider endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/agent-card` | none | A2A discovery card with live price, model, capabilities |
| `GET` | `/.well-known/agent-card.json` | none | Same as `/agent-card` (well-known alias) |
| `POST` | `/v1/sessions` | x402 | Open session; pay opening tick; start streaming |
| `POST` | `/v1/sessions/:id/pull` | x402 | Pay elapsed seconds; collect buffered tokens |
| `POST` | `/v1/sessions/:id/stop` | none | Tap-to-stop; get attestation header |
| `GET` | `/healthz` | none | Liveness: GPU, model, idle state, live price |
| `GET` | `/stats` | none | Earnings summary + system snapshot + pricing |
| `GET` | `/metrics` | none | Prometheus text format metrics |
| `POST` | `/v1/demo` | none | Rate-limited free demo (80 tokens) |
| `GET` | `/` | none | Live earnings dashboard |
| `GET` | `/node` | none | DePIN operator console |
| `GET` | `/node-info` | none | JSON: chain, USDC address, model, price |
| `GET` | `/gateway-balance` | none | Seller's Circle Gateway USDC balance |

### Discovery API

| Method | Path | Params | Description |
|---|---|---|---|
| `GET` | `/api/providers` | `sortBy`, `limit` | List providers (on-chain or coordinator) |
| `GET` | `/api/providers/:id` | — | Single provider by registry ID |
| `GET` | `/api/providers/search` | `q` | Search by model name |
| `GET` | `/api/market-stats` | — | Network stats + this node + on-chain status |

### Open session request/response

```bash
# 1. First request (no PAYMENT-SIGNATURE) → 402 challenge
curl -X POST http://localhost:19131/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Explain x402 in one sentence."}]}'
# ← 402  PAYMENT-REQUIRED: <base64 requirements>

# 2. Signed retry via GatewayClient (buyer-core.js handles this automatically)
# ← 200  { sessionId, tokens, receipt: { transaction, amountUsdc, priceBreakdown }, state }
```

### Pull response

```json
{
  "tokens": "...streamed text from this interval...",
  "done": false,
  "receipt": { "transaction": "0xabc...", "amountUsdc": 0.00014 },
  "state": { "sessionId": "...", "seconds": 3.0, "costUsdc": 0.00042, "status": "streaming" }
}
```

Final pull (`done: true`) also carries `x-inference-attestation: <base64-json>` header.

---

## Three web pages

| Page | Route | Who |
|---|---|---|
| Live earnings **meter** | `/` | anyone watching the node earn |
| **Buyer console** (prompt, stream, tap-to-stop) | `:19132/` (`npm run console`) | a human buyer |
| **DePIN operator console** (connect wallet → your earnings) | `/node` | the node operator |

---

## Layout

```
contracts/
  InferenceProviderRegistry.sol   on-chain reputation + earnings registry
src/
  pricing.js          provider pricing agent (6-factor dynamic pricing)
  agent-buyer.js      reasoning buyer agent (discover → negotiate → judge → stop)
  buyer-core.js       shared pay-per-second loop + attestation verification
  buyer.js            CLI buyer
  buyer-server.js     web buyer server
  session.js          server-side streaming sessions + reaper + locked price
  metering.js         per-second Meter + interval billing            [tested]
  payment.js          x402 verify+settle with 3x retry hardening    [tested]
  earnings.js         append-only USDC earnings ledger              [tested]
  attestation.js      EIP-191 sign + verify per inference session   [tested]
  registry.js         viem client for InferenceProviderRegistry
  registry-reporter.js hourly on-chain metric flush + accumulator
  metrics.js          Prometheus counters + histograms              [tested]
  logger.js           structured JSON logger (pino-compatible)      [tested]
  server.js           x402 sidecar + agent card + dashboards + /metrics
  sysmon.js           GPU stats + system snapshot
  idle.js             idle machine detection
  config.js           env-driven config + USDC conversion helpers
  coordinator-client.js peer registration with the coordinator node
  index.js            provider entrypoint
scripts/
  deploy-registry.mjs     deploy InferenceProviderRegistry to Arc testnet
  register-provider.mjs   register this node in the on-chain registry
  seed-traffic.mjs        continuous buyer agents for traction/demo
  smoke.mjs               server smoke test (verifies 402 challenge)
  withdraw-seller.mjs     withdraw Gateway earnings on-chain
test/
  unit.test.js            metering, earnings, payment primitives
  phase5.test.js          pricing, attestation, metrics, logger
site/                     Next.js marketplace site (Vercel)
  app/marketplace/        live provider leaderboard (from coordinator)
```

---

## Run it

```bash
npm install
npm test            # 29 offline unit tests, 0 fail
npm run smoke       # boots server, verifies x402 402 challenge

# Inference backend (pick one)
./models/Qwen2.5-0.5B-Instruct-Q4_K_M.llamafile --server --nobrowser --port 8080
# OR: ollama serve && ollama pull qwen2.5:0.5b
# OR: set INFERENCE_BASE= to any OpenAI-compatible API (Groq, Together, etc.)

# Provider node (copy .env.example → .env, fill SELLER_PRIVATE_KEY + SELLER_ADDRESS)
npm start
# → structured JSON logs to stderr; dashboard at :19131/, metrics at :19131/metrics

# On-chain registration (one-time)
npm run contracts:compile
npm run contracts:deploy    # deploys if REGISTRY_ADDRESS not already in .env
npm run provider:register   # registers this node; appends PROVIDER_ID to .env

# Buyers (BUYER_PRIVATE_KEY funded at faucet.circle.com)
npm run agent -- --goal "Explain Arc in two sentences" --budget 0.003
npm run console                              # browser buyer at :19132
npm run seed -- --workers 2 --duration 60   # sustained traction
```

### Environment variables

```env
# .env (copy from .env.example)

# Provider / seller
SELLER_PRIVATE_KEY=0x...        # Arc wallet that receives USDC
SELLER_ADDRESS=0x...            # same wallet, public address
MODEL=qwen2.5:0.5b              # Ollama model tag or llamafile model name
PRICE_USDC_PER_SECOND=0.0001    # base price (dynamic pricing multiplies this)
PORT=19131

# On-chain registry (populated by deploy + register scripts)
REGISTRY_ADDRESS=0x3daf601556f6c095c632216ead1306574d423abf
PROVIDER_ID=1

# Buyer
BUYER_PRIVATE_KEY=0x...         # funded Arc wallet

# Optional
INFERENCE_BASE=http://localhost:8080/v1   # OpenAI-compat inference endpoint
COORDINATOR_URL=https://joule-coordinator.onrender.com
LOG_LEVEL=info                  # trace|debug|info|warn|error|fatal
PULL_GRACE_SECONDS=30           # reap silent buyers after this many seconds
MODEL_PRICE_MULT=               # override model-size factor
```

---

## Going public (DePIN)

```bash
# Expose your node to other buyer agents
npx localtunnel --port 19131
# or: ngrok http 19131 / cloudflared tunnel --url http://localhost:19131

# Buyers point PROVIDERS at your public URL
PROVIDERS="https://your-node.loca.lt" npm run agent -- --goal "..."
```

The buyer agent discovers each node's live price via `/agent-card` and picks the best deal.
Multi-node discovery also works via the coordinator's `/nodes` endpoint.

---

## Status

- [x] Pay-per-second x402 settlement on Arc (zero settle failures at volume)
- [x] Agent-to-agent market: 6-factor pricing agent + reasoning buyer (discover / negotiate / judge / stop)
- [x] On-chain reputation registry deployed at `0x3daf601556f6c095c632216ead1306574d423abf`
- [x] Cryptographic attestation: EIP-191 sign on every session, buyer auto-verifies
- [x] Settlement hardening: 3× retry with exponential backoff
- [x] Prometheus metrics at `/metrics` + structured JSON logging
- [x] Three live UIs (meter, buyer console, wallet-connect DePIN operator console)
- [x] Real earnings accrue to the seller's Gateway balance (`/gateway-balance`), withdrawable on-chain
- [x] 29 unit tests, 0 fail (pricing, metering, earnings, payment, attestation, metrics, logger)
- [x] Marketplace site at `/marketplace` (live coordinator provider list)

## Notes

- Wallet-connect needs a browser wallet on Arc (MetaMask auto-adds it); falls back to pasting an address.
- On-chain withdrawal of seller earnings becomes available once Circle flushes batched settlements
  (≥ ~0.0053 USDC); see `npm run withdraw`.
- The `data/` directory is created on first run and holds `earnings.jsonl`, `attestations.jsonl`,
  `verifications.jsonl`. Add it to `.gitignore` — it contains real payment data.
