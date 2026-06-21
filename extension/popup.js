// Popup: thin UI over chrome.storage. Settings + the online toggle are written to
// storage; the offscreen worker reacts to them. Runtime stats are read back from
// storage and rendered live.

const $ = (id) => document.getElementById(id);

chrome.runtime.sendMessage({ cmd: "ensureOffscreen" }); // make sure the worker page exists

async function loadSettings() {
  const s = await chrome.storage.local.get(["coordinatorUrl", "payout", "model", "online"]);
  $("coord").value = s.coordinatorUrl || "http://localhost:19150";
  $("payout").value = s.payout || "";
  if (s.model) $("model").value = s.model;
  setToggle(!!s.online);
}

function setToggle(on) {
  const t = $("toggle");
  t.textContent = on ? "Go offline" : "Go online";
  t.className = "toggle " + (on ? "on" : "off");
  t.dataset.on = on ? "1" : "";
}

function render(rt) {
  if (!rt) return;
  $("earned").textContent = Number(rt.earned || 0).toFixed(6);
  $("status").textContent = rt.status || "offline";
  $("jobs").textContent = rt.jobsDone || 0;
  $("engine").textContent = rt.engineMode === "webgpu" ? "WebGPU" : rt.engineMode === "stub" ? "stub" : "—";
  const loading = (rt.status || "").includes("loading") || (rt.modelPct > 0 && rt.modelPct < 100);
  $("barWrap").hidden = !loading;
  $("barfill").style.width = (rt.modelPct || 0) + "%";
  $("bartext").textContent = rt.modelText ? `${rt.modelPct || 0}% · ${rt.modelText}` : `${rt.modelPct || 0}%`;
}

// Persist settings as they change.
for (const [id, key] of [["coord", "coordinatorUrl"], ["payout", "payout"], ["model", "model"]]) {
  $(id).addEventListener("change", () => chrome.storage.local.set({ [key]: $(id).value.trim() }));
}

$("toggle").addEventListener("click", async () => {
  const on = !$("toggle").dataset.on;
  // make sure latest settings are saved before flipping online
  await chrome.storage.local.set({
    coordinatorUrl: $("coord").value.trim(),
    payout: $("payout").value.trim(),
    model: $("model").value,
    online: on,
  });
  setToggle(on);
});

chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && c.runtime) render(c.runtime.newValue);
});

(async () => {
  await loadSettings();
  const { runtime } = await chrome.storage.local.get("runtime");
  render(runtime);
})();
