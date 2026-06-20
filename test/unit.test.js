// Offline unit tests for the pure billing + ledger logic (no network, no creds).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Meter, quoteMaxUsdc } from "../src/metering.js";
import { Earnings } from "../src/earnings.js";
import { buildRequirements, paymentRequiredHeader } from "../src/payment.js";
import { config, usdcToAtomic, atomicToUsdc } from "../src/config.js";

test("usdc atomic conversion round-trips at 6 decimals", () => {
  assert.equal(usdcToAtomic(1), 1_000_000);
  assert.equal(usdcToAtomic(0.000001), 1);
  assert.equal(atomicToUsdc(2_500_000), 2.5);
});

test("Meter accrues per-second cost over elapsed time", () => {
  const m = new Meter({ pricePerSecondUsdc: 0.01 });
  m.start();
  m.startedAt -= 3000; // simulate 3 seconds elapsed
  m.lastBilledAt = m.startedAt;
  const usd = m.costUsdc();
  assert.ok(usd >= 0.0299 && usd <= 0.0301, `expected ~0.03, got ${usd}`);
});

test("Meter interval billing advances the cursor", () => {
  const m = new Meter({ pricePerSecondUsdc: 0.01 });
  m.start();
  m.startedAt -= 2000;
  m.lastBilledAt = m.startedAt;
  const first = m.commitInterval();
  assert.ok(first >= usdcToAtomic(0.0199), `first interval billed ${first}`);
  // Immediately after committing, the next pending interval is ~floor, not the full elapsed again.
  const pending = m.pendingIntervalAtomic();
  assert.ok(pending <= usdcToAtomic(0.001), `pending after commit should be tiny, got ${pending}`);
});

test("quoteMaxUsdc scales with max session seconds", () => {
  const q = quoteMaxUsdc(100);
  assert.equal(q, Number((100 * config.pricePerSecondUsdc).toFixed(6)));
});

test("buildRequirements targets Arc testnet USDC + GatewayWallet", () => {
  const r = buildRequirements(1234, { endpoint: "/v1/sessions" });
  assert.equal(r.network, "eip155:5042002");
  assert.equal(r.asset, "0x3600000000000000000000000000000000000000");
  assert.equal(r.extra.verifyingContract, "0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
  assert.equal(r.amount, "1234");
  assert.equal(r.scheme, "exact");
});

test("paymentRequiredHeader is decodable base64 JSON with the requirements", () => {
  const r = buildRequirements(500, { endpoint: "/v1/sessions/abc/pull" });
  const header = paymentRequiredHeader(r, "/v1/sessions/abc/pull");
  const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  assert.equal(decoded.x402Version, 2);
  assert.equal(decoded.accepts[0].amount, "500");
});

test("Earnings ledger appends and summarizes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "idle-earn-"));
  const file = join(dir, "earnings.jsonl");
  try {
    const e = new Earnings(file);
    await e.record({ sessionId: "s1", model: "m", payer: "0xA", seconds: 1, amountAtomic: 200 });
    await e.record({ sessionId: "s1", model: "m", payer: "0xA", seconds: 1, amountAtomic: 200 });
    const s = await e.summary();
    assert.equal(s.jobs, 2);
    assert.equal(s.totalUsdc, atomicToUsdc(400));
    assert.equal(s.totalSeconds, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
