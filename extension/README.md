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
locally, and posts the result back — then the coordinator credits the node.

## Run it

```bash
# 1) start the coordinator (in the idle-compute repo)
npm run coordinator                      # http://localhost:19150

# 2) load the extension
#    chrome://extensions → Developer mode → Load unpacked → select this /extension folder

# 3) open the popup → set Coordinator URL + payout wallet → "Go online"

# 4) send it a job
npm run lite:ask -- "Explain x402 in one line"
```

The popup shows live status, jobs done, and USDC earned; the coordinator's network
dashboard (`http://localhost:19150`) lists the lite node alongside native nodes.

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

- Earnings are credited by the coordinator (demo accounting). Real per-second USDC
  settlement for the lite path would add the in-browser x402 / Gateway signing flow —
  the native node already does real settlement.
- Requires a WebGPU-capable Chrome (116+). Small models only; the native node stays
  the heavy tier.
- The lite node runs **real local inference**, never a proxy to a hosted API — that
  would defeat the point.
