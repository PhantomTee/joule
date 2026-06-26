// Service worker: the single source of truth for settings + runtime stats, and
// keeper of the offscreen document (where WebGPU inference + the job-poll loop
// actually run — a service worker can't use WebGPU and gets killed too
// aggressively for long-running work).
//
// chrome.storage is not available inside the offscreen document on every
// Chrome build (observed: only chrome.runtime is injected there), so the
// offscreen worker and the popup both go through chrome.runtime messages to
// this service worker instead of touching chrome.storage directly themselves.
// An in-memory cache backs every read so a flaky/missing chrome.storage here
// degrades to "works for this session" rather than breaking outright.

const DEFAULT_COORDINATOR_URL = "https://joule-coordinator.onrender.com";

let settingsCache = null;
let runtimeCache = null;

async function storageGet(keys) {
  try {
    return (await chrome.storage?.local?.get(keys)) || {};
  } catch {
    return {};
  }
}
async function storageSet(obj) {
  try {
    await chrome.storage?.local?.set(obj);
  } catch {
    /* in-memory cache still has it */
  }
}

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "Run small AI inference jobs with WebGPU and poll the Joule coordinator for work.",
  });
}

async function getSettings() {
  if (!settingsCache) {
    const s = await storageGet(["coordinatorUrl", "payout", "model", "online", "workerId"]);
    settingsCache = {
      coordinatorUrl: s.coordinatorUrl || DEFAULT_COORDINATOR_URL,
      payout: s.payout || "",
      model: s.model || "",
      online: !!s.online,
      workerId: s.workerId || "lite-" + Math.random().toString(36).slice(2, 10),
    };
    await storageSet({ workerId: settingsCache.workerId });
  }
  return { ...settingsCache, coordinatorUrl: settingsCache.coordinatorUrl.replace(/\/$/, "") };
}

async function setSettings(patch) {
  const prev = await getSettings();
  settingsCache = { ...prev, ...patch };
  await storageSet(settingsCache);
  if ("online" in patch && !!patch.online !== !!prev.online) {
    chrome.runtime.sendMessage({ cmd: "onlineChanged", online: !!patch.online }).catch(() => {});
  }
  return settingsCache;
}

async function getRuntime() {
  if (!runtimeCache) {
    const { runtime } = await storageGet(["runtime"]);
    runtimeCache = runtime || { status: "offline", modelPct: 0, modelText: "", jobsDone: 0, earned: 0, engineMode: "none" };
  }
  return runtimeCache;
}

async function pushState(patch) {
  const cur = await getRuntime();
  runtimeCache = { ...cur, ...patch };
  await storageSet({ runtime: runtimeCache });
  chrome.runtime.sendMessage({ cmd: "runtimeUpdate", runtime: runtimeCache }).catch(() => {});
  return runtimeCache;
}

chrome.runtime.onInstalled.addListener(ensureOffscreen);
chrome.runtime.onStartup.addListener(ensureOffscreen);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.cmd) return;
  const handlers = {
    ensureOffscreen: () => ensureOffscreen().then(() => ({ ok: true })),
    getSettings,
    setSettings: () => setSettings(msg.patch || {}),
    getRuntime,
    pushState: () => pushState(msg.patch || {}),
  };
  const fn = handlers[msg.cmd];
  if (!fn) return;
  fn().then(sendResponse);
  return true;
});
