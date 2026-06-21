// Service worker: its only job is to keep the offscreen document alive — that's
// where WebGPU inference and the job-poll loop actually run (a service worker
// can't use WebGPU and gets killed too aggressively for long-running work).

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "Run small AI inference jobs with WebGPU and poll the Joule coordinator for work.",
  });
}

chrome.runtime.onInstalled.addListener(ensureOffscreen);
chrome.runtime.onStartup.addListener(ensureOffscreen);
// Recreate on demand (popup pings this when the user opens it).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.cmd === "ensureOffscreen") {
    ensureOffscreen().then(() => sendResponse({ ok: true }));
    return true;
  }
});
