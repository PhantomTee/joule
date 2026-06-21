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

## The two agents

- **Provider pricing agent** ([pricing.js](src/pricing.js)) — quotes a per-second price that **surges when
  busy** and **discounts when the machine is idle**. Advertised live on its A2A agent card.
- **Buyer agent** ([agent-buyer.js](src/agent-buyer.js)) — discovers providers via their agent cards,
  **walks away if the price is over its max**, otherwise streams and **judges the answer each second with a
  model**, stopping on its own (or at its budget). Every decision is narrated.

```bash
npm run agent -- --goal "Name two colors." --budget 0.003 --max-price 0.0005
#  discovered idle-compute node @ 0.00014/sec (machine idle → 0.7x discount)
#  deal accepted (≤ 0.0005) · streams, judges, stops on its own
npm run agent -- --goal "..." --max-price 0.0001
#  cheapest quote 0.0003/sec is above my max → walking away (no deal)
```

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

## Three web pages

| Page | Route | Who |
|---|---|---|
| Live earnings **meter** | `/` | anyone watching the node earn |
| **Buyer console** (prompt, stream, tap-to-stop) | `:19132/` (`npm run console`) | a human buyer |
| **DePIN operator console** (connect wallet → your earnings) | `/node` | the node operator |

## Layout

```
src/pricing.js        provider pricing agent (demand-based)
src/agent-buyer.js    reasoning buyer agent (discover → judge → decide)
src/buyer-core.js     shared pay-per-second loop
src/buyer.js          CLI buyer · src/buyer-server.js + buyer-console.js  web console
src/inference.js      OpenAI-compatible client (llamafile / Ollama / hosted)
src/session.js        server-side streaming sessions + reaper + locked price
src/metering.js       per-second Meter + interval billing            (tested)
src/payment.js        real x402 verify+settle (BatchFacilitator)     (tested)
src/earnings.js       append-only USDC earnings ledger               (tested)
src/server.js         x402 sidecar + agent card + dashboards
src/dashboard.js · node-console.js   served UIs
src/sysmon.js · idle.js · config.js · index.js
```

## Run it

```bash
npm install
npm test            # offline unit tests
npm run smoke       # boots server, verifies the x402 402 challenge

# Inference backend — a single Qwen llamafile, no install (or Ollama / a hosted API)
./models/Qwen2.5-0.5B-Instruct-Q4_K_M.llamafile --server --nobrowser --port 8080

# Provider (SELLER_ADDRESS set in .env)
npm start                  # meter at :19131/ , operator console at :19131/node

# Buyers (BUYER_PRIVATE_KEY funded at faucet.circle.com)
npm run agent -- --goal "Explain Arc in two sentences" --budget 0.003
npm run console            # browser buyer at :19132
npm run seed -- --workers 2 --duration 60     # traction: sustained volume
```

## Going public (DePIN)

The node serves on `localhost` by default. To let other people's buyer agents reach it, expose the port
with a tunnel and share the URL — buyers point `PROVIDERS` (or `BASE_URL`) at it:

```bash
# operator: put your node online
npx localtunnel --port 19131        # or: ngrok http 19131  /  cloudflared tunnel --url http://localhost:19131

# buyer: aim an agent at one or more public nodes
PROVIDERS="https://your-node.loca.lt,https://other-node.example" npm run agent -- --goal "..."
```

The buyer agent discovers each node's live price via `/agent-card` and picks the best deal. Nothing else
changes — payment, streaming, and tap-to-stop already work across the network.

## Status

- [x] Pay-per-second x402 settlement on Arc, verified at volume (zero settle failures)
- [x] Agent-to-agent market: provider pricing agent + reasoning buyer (discover / negotiate / judge / stop)
- [x] Three live UIs (meter, buyer console, wallet-connect DePIN operator console)
- [x] Real earnings accrue to the seller's Gateway balance (`/gateway-balance`), withdrawable on-chain
- [x] Unit tests + smoke green

## Notes

- Wallet-connect needs a browser wallet on Arc (MetaMask auto-adds it); falls back to pasting an address.
- On-chain withdrawal of seller earnings becomes available once Circle flushes batched settlements
  (≥ ~0.0053 USDC); see `npm run withdraw`.
