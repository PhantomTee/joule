// The lite node's engine + work loop. Settings and runtime stats go through
// chrome.runtime messages to the background service worker (chrome.storage is
// not reliably available inside this offscreen document — only chrome.runtime
// is guaranteed here), which polls the coordinator for jobs, runs them locally
// (WebGPU via web-llm), and posts results back.

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
  await chrome.runtime.sendMessage({ cmd: "pushState", patch }).catch(() => {});
}

async function settings() {
  const s = (await chrome.runtime.sendMessage({ cmd: "getSettings" }).catch(() => null)) || {};
  return {
    coordinatorUrl: s.coordinatorUrl,
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
    const webllm = await import("./vendor/web-llm.js");
    if (!navigator.gpu) throw new Error("WebGPU not available in this browser");
    await pushState({ status: "loading model", modelText: "starting..." });
    engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (p) => pushState({ modelPct: Math.round((p.progress || 0) * 100), modelText: p.text || "" }),
    });
    engineMode = "webgpu";
  } catch (err) {
    engine = null;
    engineMode = "stub";
    await pushState({ modelText: "stub mode (" + err.message + ")" });
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
    output = reply.choices && reply.choices[0] && reply.choices[0].message ? reply.choices[0].message.content : "";
  } else {
    await new Promise((r) => setTimeout(r, 600));
    output = "[stub] You asked: \"" + prompt.slice(0, 120) + "\". Load the WebGPU model for real inference.";
  }
  const seconds = Math.max(1, Math.round((performance.now() - started) / 1000));
  return { output, seconds };
}

// --- coordinator I/O -------------------------------------------------------
async function register(s) {
  try {
    await fetch(s.coordinatorUrl + "/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: s.workerId,
        name: "Browser lite node",
        url: null,
        model: engineMode === "webgpu" ? s.model : s.model + " (stub)",
        pricePerSecond: PRICE_PER_SEC,
        sellerAddress: s.payout || null,
        kind: "lite",
      }),
    });
    registered = true;
  } catch (e) {}
}

async function heartbeat(s) {
  try {
    await fetch(s.coordinatorUrl + "/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: s.workerId, pricePerSecond: PRICE_PER_SEC }),
    });
  } catch (e) {}
  await syncEarnings(s);
}

async function syncEarnings(s) {
  try {
    var data = await fetch(s.coordinatorUrl + "/nodes").then(function(r) { return r.json(); });
    var self = data.nodes.find(function(n) { return n.id === s.workerId; });
    if (self) await pushState({ earned: Number(self.earnedUsdc) || 0 });
  } catch (e) {}
}

async function poll() {
  if (busy) return;
  const s = await settings();
  if (!s.online) return;
  if (!registered) await register(s);
  if (!engine && engineMode === "none") await loadEngine(s.model);
  let job;
  try {
    job = await fetch(s.coordinatorUrl + "/jobs/claim?worker=" + encodeURIComponent(s.workerId)).then(function(r) { return r.json(); });
  } catch (e) {
    await pushState({ status: "coordinator unreachable" });
    return;
  }
  if (!job || job.none) {
    await pushState({ status: engineMode === "webgpu" ? "online - waiting for work" : "online (stub) - waiting" });
    return;
  }
  busy = true;
  await pushState({ status: "running job " + job.id });
  try {
    const res = await infer(job.prompt, job.maxTokens || 128);
    await fetch(s.coordinatorUrl + "/jobs/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: job.id, worker: s.workerId, output: res.output, seconds: res.seconds }),
    });
    await pushState({ jobsDone: state.jobsDone + 1, status: "online - idle" });
    await syncEarnings(s);
  } catch (err) {
    await pushState({ status: "job failed: " + err.message });
  } finally {
    busy = false;
  }
}

// --- lifecycle -------------------------------------------------------------
async function start() {
  const s = await settings();
  await register(s);
  await syncEarnings(s);
  loadEngine(s.model);
  clearInterval(pollTimer);
  clearInterval(beatTimer);
  pollTimer = setInterval(poll, POLL_MS);
  beatTimer = setInterval(function() { settings().then(heartbeat); }, HEARTBEAT_MS);
  await pushState({ status: "online - idle" });
}

function stop() {
  clearInterval(pollTimer);
  clearInterval(beatTimer);
  pollTimer = beatTimer = null;
  registered = false;
  pushState({ status: "offline" });
}

// react to toggle from popup (relayed via background service worker)
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg && msg.cmd === "onlineChanged") {
    if (msg.online) start(); else stop();
  }
});

// boot
(function() {
  settings().then(function(s) {
    pushState({ engineMode: "none", status: s.online ? "starting..." : "offline" });
    if (s.online) start();
  });
})();
