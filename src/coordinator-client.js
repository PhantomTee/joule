// Provider → coordinator registration. By default every node joins the shared,
// always-on Joule network (config.defaultCoordinatorUrl) — announcing itself
// OUTBOUND (register + heartbeat over HTTP), so it's discoverable with zero
// setup and no inbound port-forwarding. Set COORDINATOR_URL to point at a
// different directory, or to "off"/"none" to run solo (no network at all).

import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export function startCoordinatorClient() {
  const raw = process.env.COORDINATOR_URL;
  if (raw && /^(off|none|0|false)$/i.test(raw.trim())) return null;
  const coord = (raw || config.defaultCoordinatorUrl).replace(/\/$/, "");

  const id = process.env.NODE_ID || `joule-${randomUUID().slice(0, 8)}`;
  const name = process.env.NODE_NAME || `Joule ${id.slice(-4)}`;
  const selfUrl = process.env.PUBLIC_URL || `http://localhost:${config.port}`;
  const base = `http://localhost:${config.port}`;

  async function snapshot() {
    let price = config.pricePerSecondUsdc, model = config.model, active = 0, secs = 0, earned = 0;
    try {
      const c = await fetch(`${base}/agent-card`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json());
      price = c.payment?.perSecondUsdc ?? price;
      model = c.model ?? model;
    } catch {}
    try {
      const s = await fetch(`${base}/stats`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json());
      active = s.activeSessions || 0;
      secs = s.earnings?.totalSeconds || 0;
      earned = Number(s.earnings?.totalUsdc || 0);
    } catch {}
    return { price, model, active, secs, earned };
  }

  async function post(path, payload) {
    try {
      await fetch(`${coord}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
      });
      return true;
    } catch {
      return false;
    }
  }

  (async () => {
    const s = await snapshot();
    const ok = await post("/register", { id, name, url: selfUrl, model: s.model, pricePerSecond: s.price, sellerAddress: config.sellerAddress });
    console.log(ok ? `  joined network: ${coord} as "${name}"` : `  coordinator ${coord} unreachable (will keep trying)`);
  })();

  const timer = setInterval(async () => {
    const s = await snapshot();
    const ok = await post("/heartbeat", { id, activeSessions: s.active, secondsSold: s.secs, earnedUsdc: s.earned, pricePerSecond: s.price });
    if (!ok) await post("/register", { id, name, url: selfUrl, model: s.model, pricePerSecond: s.price, sellerAddress: config.sellerAddress });
  }, 10000);
  timer.unref?.();

  return { id, stop: () => clearInterval(timer) };
}
