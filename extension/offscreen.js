// The lite node's engine + work loop. Settings/runtime state live in the
// background service worker (chrome.storage is not available inside this
// offscreen document on every Chrome build — only chrome.runtime is injected
// here), so everything goes through chrome.runtime messaging instead.

console.log("Joule diag:", JSON.stringify({
  hasChrome: typeof chrome !== "undefined",
  chromeKeys: typeof chrome !== "undefined" ? Object.keys(chrome) : null,
  hasRuntime: typeof chrome !== "undefined" && !!chrome.runtime,
  runtimeId: typeof chrome !== "undefined" && chrome.runtime ? chrome.runtime.id : null,
  hasStorage: typeof chrome !== "undefined" && !!chrome.storage,
  storageKeys: typeof chrome !== "undefined" && chrome.storage ? Object.keys(chrome.storage) : null,
  hasGpu: typeof navigator !== "undefined" && !!navigator.gpu,
  origin: typeof location !== "undefined" ? location.href : null,
}));

const PRICE_PER_SEC = 0.0001; // lite-node rate (USDC/sec) — small models, small price
const DEFAULT_MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const POLL_MS = 2500;
const HEARTBEAT_MS = 25000;

let engine = null;
let engineMode = "none"; // "webgpu" | "stub"
let loadingModel = false;
let busy = false;
let pollTimer = null;
let beatTimer = null;
let registered = false;

const state = { status: "offline", modelPct: 0, modelText: "", jobsDone: 0, earned: 0, engineMode: "none", lastJob: "" };
async function pushState(patch = {}) {
  Object.assign(state, patch);
  await chrome.runtime.sendMessage({ cmd: "pushState", patch: state });
}

async function settings() {
  const s = await chrome.runtime.sendMessage({ cmd: "getSettings" });
  return {
    coordinatorUrl: (s.coordinatorUrl || "https://joule-coordinator.onrender.com").replace(/\/$/, ""),
    payout: s.payout || "",
    model: s.model || DEFAULT_MODEL,
    online: !!s.online,
    workerId: s.workerId,
  };
}

// --- engine ----------------------------------------------------------------
async function loadEngine(model) {
  if (engine || loadingModel) return;
  loadingModel = true;
  try {
    const webllm = await import("./vendor/web-llm.js"); // produced by `npm run build` in /extension
    if (!navigator.gpu) throw new Error("WebGPU not available in this browser");
    await pushState({ status: "loading model", modelText: "starting…" });
    engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (p) => pushState({ modelPct: Math.round((p.progress || 0) * 100), modelText: p.text || "" }),
    });
    engineMode = "webgpu";
  } catch (err) {
    // No bundled model (or no WebGPU): fall back to a clearly-labeled stub so the
    // pull→run→result loop is still demonstrable. Build the model for real inference.
    engine = null;
    engineMode = "stub";
    await pushState({ modelText: `stub mode (${err.message})` });
  } finally {
    loadingModel = false;
    await pushState({ engineMode });
  }
}

async function infer(prompt, maxTokens) {
  const started = performance.now();
  let output;
  if (engineMode === "webgpu" && engine) {
    const reply = await engine.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7,
    });
    output = reply.choices?.[0]?.message?.content ?? "";
  } else {
    // Stub: proves the loop without a model. Replace by building web-llm.
    await new Promise((r) => setTimeout(r, 600));
    output = `[stub answer] You asked: "${prompt.slice(0, 120)}". Build the WebGPU model for real inference.`;
  }
  const seconds = Math.max(1, Math.round((performance.now() - started) / 1000));
  return { output, seconds };
}

// --- coordinator I/O -------------------------------------------------------
async function register(s) {
  try {
    await fetch(`${s.coordinatorUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: s.workerId,
        name: "Browser lite node",
        url: null,
        model: engineMode === "webgpu" ? s.model : `${s.model} (stub)`,
        pricePerSecond: PRICE_PER_SEC,
        sellerAddress: s.payout || null,
        kind: "lite",
      }),
    });
    registered = true;
  } catch {}
}
async function heartbeat(s) {
  try {
    await fetch(`${s.coordinatorUrl}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: s.workerId, secondsSold: undefined, earnedUsdc: undefined, pricePerSecond: PRICE_PER_SEC }),
    });
  } catch {}
  await syncEarnings(s);
}

// Earnings are only real once a buyer actually pays (POST /jobs/:id/pay on the
// coordinator, straight to this node's own wallet) — read back the coordinator's
// authoritative total instead of estimating locally.
async function syncEarnings(s) {
  try {
    const { nodes } = await fetch(`${s.coordinatorUrl}/nodes`).then((r) => r.json());
    const self = nodes.find((n) => n.id === s.workerId);
    if (self) await pushState({ earned: Number(self.earnedUsdc) || 0, secondsSold: Number(self.secondsSold) || 0 });
  } catch {}
}

async function poll() {
  if (busy) return;
  const s = await settings();
  if (!s.online) return;
  if (!registered) await register(s);
  if (!engine && engineMode === "none") await loadEngine(s.model);

  let job;
  try {
    job = await fetch(`${s.coordinatorUrl}/jobs/claim?worker=${encodeURIComponent(s.workerId)}`).then((r) => r.json());
  } catch {
    await pushState({ status: "coordinator unreachable" });
    return;
  }
  if (!job || job.none) {
    await pushState({ status: engineMode === "webgpu" ? "online · waiting for work" : "online (stub) · waiting" });
    return;
  }

  busy = true;
  await pushState({ status: `running job ${job.id}`, lastJob: job.prompt });
  try {
    const { output, seconds } = await infer(job.prompt, job.maxTokens || 128);
    await fetch(`${s.coordinatorUrl}/jobs/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: job.id, worker: s.workerId, output, seconds }),
    });
    await pushState({ jobsDone: state.jobsDone + 1, status: "online · idle, awaiting payment" });
    await syncEarnings(s); // usually still 0 here — credited once the buyer actually pays
  } catch (err) {
    await pushState({ status: `job failed: ${err.message}` });
  } finally {
    busy = false;
  }
}

// --- lifecycle -------------------------------------------------------------
async function start() {
  const s = await settings();
  await register(s);
  await syncEarnings(s); // pick up this node's real on-chain-settled total, if any
  loadEngine(s.model); // lazy; doesn't block polling
  clearInterval(pollTimer);
  clearInterval(beatTimer);
  pollTimer = setInterval(poll, POLL_MS);
  beatTimer = setInterval(async () => heartbeat(await settings()), HEARTBEAT_MS);
  await pushState({ status: "online · idle" });
}
function stop() {
  clearInterval(pollTimer);
  clearInterval(beatTimer);
  pollTimer = beatTimer = null;
  registered = false;
  pushState({ status: "offline" });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.cmd !== "onlineChanged") return;
  msg.online ? start() : stop();
});

async function init() {
  const s = await settings();
  await pushState({ engineMode: "none", status: s.online ? "starting…" : "offline" });
  if (s.online) start();
}
init().catch((err) => console.error("Joule offscreen init failed:", err));
