# Joule — lite node (browser extension)

A zero-install Joule node. Instead of downloading the `.exe`, you install a Chrome
extension that runs **small AI models in your browser with WebGPU** and earns USDC
for the inference jobs it completes. Inspired by Grass's extension, but selling
*compute* instead of bandwidth.

## How it differs from the native node

|  | Native node (`joule-node.exe`) | Lite node (this extension) |
|--|--|--|
| Install | download + run | one-click browser extension |
| Models | any local model, full GPU | small models via WebGPU |
| Connectivity | serves buyers directly (inbound) | **pulls** jobs from the coordinator (no inbound) |
| Best for | serious capacity | mass, passive, zero-friction |

Because an extension can't accept inbound connections, the lite node **pulls** work:
a buyer posts a job to the coordinator's queue, the extension claims it, runs it
locally, and posts the result back.

## Real settlement (no mock)

Payment is **real USDC on Arc**, not coordinator-credited demo accounting. When a
job is done, the buyer pays through the coordinator via the same x402 facilitator
the native node uses (`@circle-fin/x402-batching`) — the only difference is `payTo`
is **this specific job's worker wallet**, frozen at claim time. The coordinator
never holds the funds; it just brokers the 402 challenge and forwards the signed
payment to settlement. The job's output is withheld until payment settles — pay,
then read, exactly like the native node's per-second pulls.

```bash
# 1) load the extension
#    chrome://extensions → Developer mode → Load unpacked → select this /extension folder
#    it joins the shared, always-on network (joule-coordinator.onrender.com) by
#    default — nothing to start. Want a private network instead? Run your own
#    (`npm run coordinator`) and put its URL in the popup's Coordinator URL field.

# 2) open the popup → set a payout wallet → "Go online"

# 3) pay for a real job (needs BUYER_PRIVATE_KEY funded on Arc testnet in .env)
npm run buy-lite -- --coordinator https://joule-coordinator.onrender.com --prompt "Explain x402 in one line"
```

The popup shows live status, jobs done, and **Settled on Arc** — the node's real,
coordinator-confirmed earnings (it only updates once a buyer's payment actually
clears, so it can lag a few seconds behind "jobs done"). The network dashboard at
[joule-coordinator.onrender.com](https://joule-coordinator.onrender.com) lists the
lite node alongside native nodes.

To test the loop without installing the extension, `node scripts/sim-lite-worker.mjs`
stands in for a browser worker (claim → deliver) so you can drive `buy-lite` end to
end from the CLI.

## Real WebGPU inference (optional build step)

MV3 forbids loading remote scripts, so the model engine must be bundled locally.
Until you build it, the node runs in a **clearly-labeled stub mode** so the whole
loop (claim → run → result → earn) works end-to-end.

```bash
cd extension
npm install        # @mlc-ai/web-llm + esbuild
npm run build      # writes vendor/web-llm.js
# reload the extension → it now downloads a small model on first job and runs real WebGPU inference
```

## Honest scope

- Requires a WebGPU-capable Chrome (116+). Small models only; the native node stays
  the heavy tier.
- The lite node runs **real local inference**, never a proxy to a hosted API — that
  would defeat the point.
