// Boots the real server and probes the free + 402-challenge paths (no creds, no Ollama).
// Verifies the HTTP sidecar and x402 challenge wiring end-to-end in-process.
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";

const { server } = createServer({ idleMonitor: { seconds: 999 } });
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}`;

try {
  // 0) dashboard renders
  const dash = await fetch(`${base}/`);
  assert.equal(dash.status, 200);
  assert.match(dash.headers.get("content-type"), /text\/html/);
  assert.match(await dash.text(), /idle-compute/);
  console.log("✓ GET / -> 200 dashboard HTML");

  // 1) /healthz is free and returns liveness
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.paymentMode, "circle");
  console.log("✓ GET /healthz -> 200", JSON.stringify(healthBody.gpu));

  // 2) /stats is free and reports pricing
  const stats = await fetch(`${base}/stats`);
  assert.equal(stats.status, 200);
  const statsBody = await stats.json();
  assert.ok(statsBody.pricing.usdcPerSecond > 0);
  console.log("✓ GET /stats -> 200  pricing:", JSON.stringify(statsBody.pricing));

  // 3) Opening a session WITHOUT payment must return a 402 x402 challenge
  const open = await fetch(`${base}/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(open.status, 402);
  const challenge = open.headers.get("payment-required");
  assert.ok(challenge, "402 must carry PAYMENT-REQUIRED header");
  const decoded = JSON.parse(Buffer.from(challenge, "base64").toString("utf8"));
  assert.equal(decoded.x402Version, 2);
  assert.equal(decoded.accepts[0].network, "eip155:5042002");
  assert.equal(decoded.accepts[0].asset, "0x3600000000000000000000000000000000000000");
  console.log("✓ POST /v1/sessions (unpaid) -> 402 with valid x402 challenge");
  console.log("    amount:", decoded.accepts[0].amount, "atomic USDC  payTo:", decoded.accepts[0].payTo || "(SELLER_ADDRESS unset)");

  // 4) Pull on a nonexistent session -> 404
  const pull = await fetch(`${base}/v1/sessions/nope/pull`, { method: "POST" });
  assert.equal(pull.status, 404);
  console.log("✓ POST /v1/sessions/nope/pull -> 404");

  console.log("\nSmoke OK — HTTP sidecar + x402 challenge path verified.");
} finally {
  server.close();
}
