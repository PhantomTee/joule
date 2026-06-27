// Popup: thin UI over the background service worker's settings/runtime API.
// Settings + the online toggle go through chrome.runtime messages (not
// chrome.storage directly), so the background worker is the single source of
// truth and can notify the offscreen worker via "onlineChanged".

const $ = (id) => document.getElementById(id);
const DEFAULT_COORDINATOR_URL = "https://joule-coordinator.onrender.com";

chrome.runtime.sendMessage({ cmd: "ensureOffscreen" }); // make sure the worker page exists

async function loadSettings() {
  const s = await chrome.runtime.sendMessage({ cmd: "getSettings" });
  $("coord").value = s.coordinatorUrl || DEFAULT_COORDINATOR_URL;
  $("payout").value = s.payout || "";
  if (s.model) $("model").value = s.model;
  setToggle(!!s.online);
}

function setToggle(on) {
  const t = $("toggle");
  t.textContent = on ? "Go offline" : "Go online";
  t.className = "toggle " + (on ? "on" : "off");
  t.dataset.on = on ? "1" : "";
  document.body.classList.toggle("online", on);
}

function render(rt) {
  if (!rt) return;
  $("earned").textContent = Number(rt.earned || 0).toFixed(6);
  $("status").textContent = rt.status || "offline";
  $("jobs").textContent = rt.jobsDone || 0;
  $("engine").textContent = rt.engineMode === "webgpu" ? "WebGPU" : rt.engineMode === "blocked" ? "blocked (no model)" : "—";
  const loading = (rt.status || "").includes("loading") || (rt.modelPct > 0 && rt.modelPct < 100);
  $("barWrap").hidden = !loading;
  $("barfill").style.width = (rt.modelPct || 0) + "%";
  $("bartext").textContent = rt.modelText ? `${rt.modelPct || 0}% · ${rt.modelText}` : `${rt.modelPct || 0}%`;
}

// Persist settings as they change.
for (const [id, key] of [["coord", "coordinatorUrl"], ["payout", "payout"], ["model", "model"]]) {
  $(id).addEventListener("change", () => chrome.runtime.sendMessage({ cmd: "setSettings", patch: { [key]: $(id).value.trim() } }));
}

$("toggle").addEventListener("click", async () => {
  const on = !$("toggle").dataset.on;
  // make sure latest settings are saved before flipping online
  await chrome.runtime.sendMessage({
    cmd: "setSettings",
    patch: {
      coordinatorUrl: $("coord").value.trim(),
      payout: $("payout").value.trim(),
      model: $("model").value,
      online: on,
    },
  });
  setToggle(on);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.cmd === "runtimeUpdate") render(msg.runtime);
});

(async () => {
  await loadSettings();
  const runtime = await chrome.runtime.sendMessage({ cmd: "getRuntime" });
  render(runtime);
})();
