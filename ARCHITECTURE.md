# Idle-Compute — architecture

> Lepton Agents Hackathon · **RFB 4 (Streaming & Continuous Payments)** + **RFB 2 (Selling agent services)**
>
> Earn or spend USDC **per inference / per second** on idle GPU/CPU, settled on Circle Arc via x402 nanopayments.

A machine with spare GPU/CPU runs the **provider**: it keeps a local Ollama model warm and exposes a
paid, x402-gated inference endpoint. Buyer agents pay **per second of streaming** in test-USDC on Arc;
when a buyer stops paying ("tap to stop"), the provider frees the model — so unused compute is never given
away.

## Components (all Node, dependency-light)

```
src/
  config.js     # env-driven config + Arc constants + USDC atomic-unit helpers
  metering.js   # per-second / per-token Meter with interval billing (the RFB 4 core)
  earnings.js   # append-only USDC earnings ledger (JSONL)
  payment.js    # real Circle x402 settlement (BatchFacilitatorClient) — verify + settle
  ollama.js     # Ollama OpenAI-compat client: health, keep-warm, streaming chat
  sysmon.js     # CPU (node:os) + NVIDIA GPU (nvidia-smi) stats
  idle.js       # seconds-since-last-input (Windows GetLastInputInfo); idle gating
  session.js    # server-side streaming session: holds the live model stream + meter
  server.js     # HTTP sidecar: 402 gate → settle pull → release interval → stop/reap
  buyer.js      # autonomous buyer: GatewayClient pays per interval, can tap-to-stop
  index.js      # wires provider: keep-warm + idle monitor + start server
```

## Payment model (real per-second, no mock)

Real x402 settlement is request-scoped: the buyer's `GatewayClient.pay(url)` pays whatever amount the
server's `402` response quotes. To make *continuous* per-second billing real, the provider holds the
streaming model session server-side and the buyer pays in **pulls**:

1. `POST /v1/sessions` — buyer pays the opening interval (`402` → settle). Provider starts the Ollama
   stream server-side, buffering tokens, and returns the first interval's tokens + a `sessionId`.
2. `POST /v1/sessions/:id/pull` — each call settles the wall-clock seconds elapsed since the last pull
   (`secondsSinceLastPull × pricePerSecond`) and returns the tokens buffered in that interval. Repeats
   until generation finishes.
3. **Tap to stop** — the buyer simply stops pulling. After `pullGraceSeconds` with no paid pull, the
   provider aborts the model stream and finalizes the session. No charge for tokens never delivered.

Sub-cent pulls are economical because Circle Gateway batches many off-chain authorizations into one
on-chain settlement on Arc.

### The x402 settlement seam

`payment.js` verifies + settles with `BatchFacilitatorClient` from `@circle-fin/x402-batching/server`,
using `exact`-scheme requirements: network `eip155:5042002`, asset Arc USDC
`0x3600000000000000000000000000000000000000`, `payTo` = seller, `extra.verifyingContract` = GatewayWallet
`0x0077777d7EBA4688BDeF3E311b846F25870A19B9`. Prices are USD → atomic USDC (×1e6).

## Idle gating

When `REQUIRE_IDLE=true`, the provider only accepts new sessions if the machine has been idle longer than
`IDLE_THRESHOLD_SECONDS` (no keyboard/mouse), so paid inference runs on genuinely spare capacity.

## Open novelty (20% innovation axis)

Inference-specific verification — proving the provider actually ran the model — is unsolved across the
reference landscape. Candidate: challenge prompts with known outputs / sampled re-execution / a signed
model+params attestation returned in the payment receipt.

## What's needed to run end-to-end

- Local **Ollama** with a pulled model (`MODEL`, default `llama3.2`).
- `@circle-fin/x402-batching` + `viem` installed; `SELLER_ADDRESS` set; a funded buyer wallet
  (`BUYER_PRIVATE_KEY`) from https://faucet.circle.com.
- Pure-logic units (metering, earnings) run offline with `npm test`.
