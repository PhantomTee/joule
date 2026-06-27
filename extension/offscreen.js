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
let engineMode = "none"; // "webgpu" | "blocked" — "blocked" means no real model, never claims jobs
let loadingModel = false;
let busy = false;
let pollTimer = null;
let beatTimer = null;
let registered = false;
let selfCorrecting = false; // true while start() is flipping online back off itself
let blockedReason = null; // "no-webgpu" | "no-bundle" | "load-failed" — set when engineMode !== "webgpu"

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
    if (!navigator.gpu) {
      const err = new Error("WebGPU not available in this browser/device");
      err.kind = "no-webgpu";
      throw err;
    }
    let webllm;
    try {
      webllm = await import("./vendor/web-llm.js"); // produced by `npm run build` in /extension
    } catch (importErr) {
      const err = new Error("model bundle missing (vendor/web-llm.js not built)");
      err.kind = "no-bundle";
      throw err;
    }
    await pushState({ status: "loading model", modelText: "starting…" });
    engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (p) => pushState({ modelPct: Math.round((p.progress || 0) * 100), modelText: p.text || "" }),
    });
    engineMode = "webgpu";
  } catch (err) {
    // Refuse to serve: a node must never bill a buyer for a placeholder answer —
    // see `start()`, which won't go online unless engineMode === "webgpu".
    engine = null;
    engineMode = "blocked";
    blockedReason = err.kind || "load-failed";
    await pushState({ modelText: `model failed to load: ${err.message}` });
  } finally {
    loadingModel = false;
    await pushState({ engineMode });
  }
}

async function infer(prompt, maxTokens) {
  const started = performance.now();
  const reply = await engine.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.7,
  });
  const output = reply.choices?.[0]?.message?.content ?? "";
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
        model: s.model,
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
  // engineMode is guaranteed "webgpu" here — start() refuses to begin polling
  // otherwise, so a job is never claimed (and never billed) without a real model.
  if (!registered) await register(s);

  let job;
  try {
    job = await fetch(`${s.coordinatorUrl}/jobs/claim?worker=${encodeURIComponent(s.workerId)}`).then((r) => r.json());
  } catch {
    await pushState({ status: "coordinator unreachable" });
    return;
  }
  if (!job || job.none) {
    await pushState({ status: "online · waiting for work" });
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
  await pushState({ status: "loading model…" });
  await loadEngine(s.model);
  if (engineMode !== "webgpu") {
    // No real model available: refuse to register or claim jobs, and flip the
    // toggle back off so the popup reflects that the node isn't actually online.
    // The advice differs by cause — a missing bundle is a build problem (the
    // public release zip already ships it built; this only hits a from-source
    // checkout), but unsupported WebGPU is a browser/hardware limit that no
    // amount of npm can fix.
    const blockedMessages = {
      "no-webgpu": "blocked: this browser/device doesn't support WebGPU — try a different browser or device",
      "no-bundle": "blocked: model bundle missing — run `npm run build` in /extension, see README",
      "load-failed": "blocked: model failed to load — check your connection and try again",
    };
    await pushState({ status: blockedMessages[blockedReason] || blockedMessages["load-failed"] });
    selfCorrecting = true;
    await chrome.runtime.sendMessage({ cmd: "setSettings", patch: { online: false } });
    return;
  }
  await register(s);
  await syncEarnings(s); // pick up this node's real on-chain-settled total, if any
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
  if (selfCorrecting) {
    // We're the ones who just turned ourselves off (blocked, no real model) —
    // already reflected in state.status; don't let stop() clobber that message.
    selfCorrecting = false;
    return;
  }
  msg.online ? start() : stop();
});

async function init() {
  const s = await settings();
  await pushState({ engineMode: "none", status: s.online ? "starting…" : "offline" });
  if (s.online) start();
}
init().catch((err) => console.error("Joule offscreen init failed:", err));
