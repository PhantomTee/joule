// Tests for the provider pricing agent (the supply side of the A2A market).
import test from "node:test";
import assert from "node:assert/strict";
import { PricingAgent } from "../src/pricing.js";
import { config } from "../src/config.js";

const base = config.pricePerSecondUsdc;
const r = (n) => Number(n.toFixed(6));

test("quotes the base price with no load and not idle", () => {
  const q = new PricingAgent().quote({ activeSessions: 0, idleSeconds: 0 });
  assert.equal(q.price, r(base));
  assert.equal(q.multiplier, 1);
});

test("surges with concurrent demand", () => {
  const q = new PricingAgent().quote({ activeSessions: 2, idleSeconds: 0 });
  assert.ok(q.price > base, "price should rise under load");
  assert.equal(q.price, r(base * 2)); // 1 + 0.5*2
  assert.match(q.reason, /surge/);
});

test("discounts when the machine is idle and free", () => {
  const q = new PricingAgent().quote({ activeSessions: 0, idleSeconds: 300 });
  assert.ok(q.price < base, "idle should discount");
  assert.equal(q.price, r(base * 0.7));
  assert.match(q.reason, /idle/);
});

test("no idle discount while a job is active", () => {
  const q = new PricingAgent().quote({ activeSessions: 1, idleSeconds: 300 });
  assert.ok(q.price >= base); // surge applies, idle discount does not
});

test("clamps the surge to the ceiling", () => {
  const q = new PricingAgent().quote({ activeSessions: 100, idleSeconds: 0 });
  assert.equal(q.price, r(base * 4));
});
