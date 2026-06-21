// Provider → coordinator registration. If COORDINATOR_URL is set, the node
// announces itself OUTBOUND (register + heartbeat over HTTP) so it shows up on the
// network without any inbound port-forwarding. Heartbeats carry live price + stats,
// read from the node's own /agent-card and /stats.

import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export function startCoordinatorClient() {
  const coord = process.env.COORDINATOR_URL;
  if (!coord) return null;

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
