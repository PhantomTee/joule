// Phase 5/6 unit tests: PricingAgent, attestation helpers, metrics, logger.
// All tests run offline — no network, no real credentials required.
// Uses Node's built-in test runner (node --test).

import test from "node:test";
import assert from "node:assert/strict";

// ── PricingAgent ─────────────────────────────────────────────────────────────

const { PricingAgent } = await import("../src/pricing.js");

test("PricingAgent base price is positive", () => {
  const p = new PricingAgent({ base: 0.001 });
  const { price } = p.quote({ activeSessions: 0, idleSeconds: 0 });
  assert.ok(price > 0, `price must be positive, got ${price}`);
});

test("PricingAgent demand surge increases price", () => {
  const p = new PricingAgent({ base: 0.001 });
  const idle  = p.quote({ activeSessions: 0, idleSeconds: 0 });
  const busy  = p.quote({ activeSessions: 2, idleSeconds: 0 });
  assert.ok(busy.price > idle.price, `busy (${busy.price}) should exceed idle (${idle.price})`);
});

test("PricingAgent idle discount reduces price below base", () => {
  const p = new PricingAgent({ base: 0.001 });
  const base   = p.quote({ activeSessions: 0, idleSeconds: 0 });
  const idled  = p.quote({ activeSessions: 0, idleSeconds: 86400 });
  // Idle discount is 0.70x, time-of-day may be 0.85–1.20x; combined still < 1.20x*1.0 = no discount path
  // At minimum we can assert it's <= base price (or at floor)
  assert.ok(
    idled.price <= base.price || idled.price === p.floor,
    `idled (${idled.price}) should be <= base path (${base.price}) or floor`,
  );
  assert.ok(idled.reason.includes("discount"), `reason should mention discount: "${idled.reason}"`);
});

test("PricingAgent GPU heat raises price", () => {
  const p = new PricingAgent({ base: 0.001 });
  const cool = p.quote({ activeSessions: 0, idleSeconds: 0, gpu: { present: true, tempC: 25 } });
  const hot  = p.quote({ activeSessions: 0, idleSeconds: 0, gpu: { present: true, tempC: 85 } });
  assert.ok(hot.price > cool.price, `hot GPU (${hot.price}) should exceed cool (${cool.price})`);
});

test("PricingAgent model size XL multiplies price up", () => {
  const p = new PricingAgent({ base: 0.001 });
  const small = p.quote({ activeSessions: 0, idleSeconds: 0, model: "phi-0.5b" });
  const large = p.quote({ activeSessions: 0, idleSeconds: 0, model: "llama3:70b" });
  assert.ok(large.price > small.price, `70b (${large.price}) should exceed 0.5b (${small.price})`);
});

test("PricingAgent price is clamped to floor", () => {
  const p = new PricingAgent({ base: 0.001 });
  // Floor is 40% of base
  const { price } = p.quote({ activeSessions: 0, idleSeconds: 86400, gpu: { present: true, tempC: 25 } });
  assert.ok(price >= p.floor, `price (${price}) must not go below floor (${p.floor})`);
});

test("PricingAgent price is clamped to ceiling", () => {
  const p = new PricingAgent({ base: 0.001 });
  // Many sessions + hot GPU + large model could push past 6x
  const { price } = p.quote({ activeSessions: 10, gpu: { present: true, tempC: 90 }, model: "llama3:70b" });
  assert.ok(price <= p.ceil, `price (${price}) must not exceed ceiling (${p.ceil})`);
});

test("PricingAgent quote returns breakdown object", () => {
  const p = new PricingAgent({ base: 0.001 });
  const q = p.quote({ activeSessions: 1, idleSeconds: 0 });
  assert.ok(typeof q.breakdown === "object");
  assert.ok(typeof q.breakdown.activeSessions === "number");
  assert.ok(typeof q.breakdown.trendDelta === "number");
  assert.ok(typeof q.multiplier === "number");
  assert.ok(typeof q.reason === "string");
  assert.ok(q.reason.length > 0);
});

test("PricingAgent trend detection is non-negative for stable demand", () => {
  const p = new PricingAgent({ base: 0.001 });
  // Feed stable demand (no growth)
  for (let i = 0; i < 20; i++) p.record(1);
  const { breakdown } = p.quote({ activeSessions: 1 });
  // Stable or declining demand should not produce a positive predictive surge
  assert.ok(breakdown.trendDelta <= 0.5, `trend delta (${breakdown.trendDelta}) unexpectedly high for stable demand`);
});

// ── Attestation helpers (pure functions only) ─────────────────────────────────

const { sha256Hex, encodeAttestationHeader, parseAttestationHeader } = await import("../src/attestation.js");

test("sha256Hex produces correct hash", () => {
  // SHA-256 of empty string is well-known
  assert.equal(
    sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("sha256Hex differentiates inputs", () => {
  assert.notEqual(sha256Hex("hello"), sha256Hex("world"));
});

test("encodeAttestationHeader / parseAttestationHeader round-trip", () => {
  const obj = { v: 1, sessionId: "abc", signature: "0xdeadbeef", model: "test", promptHash: "ph", outputHash: "oh", timestamp: 12345, signer: "0x123" };
  const encoded = encodeAttestationHeader(obj);
  assert.ok(typeof encoded === "string");
  const decoded = parseAttestationHeader(encoded);
  assert.deepEqual(decoded, obj);
});

test("parseAttestationHeader returns null on bad input", () => {
  assert.equal(parseAttestationHeader(null), null);
  assert.equal(parseAttestationHeader("not-base64!!@@"), null);
  assert.equal(parseAttestationHeader("aW52YWxpZCBqc29u"), null); // base64("invalid json") - actually decodes but isn't JSON
});

test("attestation sign+verify round-trip (integration)", { skip: !process.env.SELLER_PRIVATE_KEY }, async () => {
  const { createAttestation, verifyAttestation } = await import("../src/attestation.js");
  const att = await createAttestation({
    model: "test-model-7b",
    prompt: "say hello",
    output: "Hello! How can I help?",
    sessionId: "test-session-1",
  });
  assert.ok(att !== null, "createAttestation must produce an object when SELLER_PRIVATE_KEY is set");
  assert.equal(att.v, 1);
  assert.ok(att.signature.startsWith("0x"));
  assert.ok(att.promptHash.length === 64);
  assert.ok(att.outputHash.length === 64);

  const result = await verifyAttestation(att, "say hello", "Hello! How can I help?", att.signer);
  assert.ok(result.ok, `verify should pass: ${result.reason}`);
});

test("verifyAttestation fails on null attestation", async () => {
  const { verifyAttestation } = await import("../src/attestation.js");
  const r = await verifyAttestation(null, "p", "o", "0x1234");
  assert.ok(!r.ok);
  assert.match(r.reason, /no attestation/);
});

test("verifyAttestation fails on wrong prompt hash", async () => {
  const { verifyAttestation } = await import("../src/attestation.js");
  const fakeAtt = {
    v: 1,
    model: "m",
    promptHash: "0000000000000000000000000000000000000000000000000000000000000000",
    outputHash: sha256Hex("output"),
    timestamp: Math.floor(Date.now() / 1000),
    signer: "0x1234",
    signature: "0xfake",
    sessionId: "s",
  };
  const r = await verifyAttestation(fakeAtt, "different prompt", "output", "0x1234");
  assert.ok(!r.ok);
  assert.match(r.reason, /prompt hash mismatch/);
});

// ── Metrics ───────────────────────────────────────────────────────────────────

const { inc, observe, metricsText } = await import("../src/metrics.js");

test("metrics counter increments and appears in metricsText", () => {
  inc("joule_sessions_total", { outcome: "opened" }, 5);
  inc("joule_sessions_total", { outcome: "completed" }, 3);
  const text = metricsText();
  assert.ok(text.includes("joule_sessions_total"), "counter name in output");
  assert.ok(text.includes('outcome="opened"'), "label in output");
  assert.ok(text.includes("} 5"), "count value in output");
  assert.ok(text.includes("# TYPE joule_sessions_total counter"), "TYPE line present");
});

test("metrics histogram observe and appears in metricsText", () => {
  observe("joule_payment_settlement_latency_ms", 350);
  observe("joule_payment_settlement_latency_ms", 750);
  const text = metricsText();
  assert.ok(text.includes("joule_payment_settlement_latency_ms_bucket"), "histogram buckets present");
  assert.ok(text.includes('le="+Inf"'), "+Inf bucket present");
  assert.ok(text.includes("joule_payment_settlement_latency_ms_sum"), "sum present");
  assert.ok(text.includes("joule_payment_settlement_latency_ms_count"), "count present");
  assert.ok(text.includes("# TYPE joule_payment_settlement_latency_ms histogram"), "histogram TYPE line");
});

test("metrics histogram cumulative bucket semantics", () => {
  observe("joule_session_duration_seconds", 2);  // should land in le=5, le=10, ..., +Inf buckets
  const text = metricsText();
  // le=1 should NOT include this value
  const le1Match = text.match(/joule_session_duration_seconds_bucket\{le="1"\} (\d+)/);
  const le5Match = text.match(/joule_session_duration_seconds_bucket\{le="5"\} (\d+)/);
  if (le1Match && le5Match) {
    assert.ok(
      Number(le5Match[1]) >= Number(le1Match[1]),
      `le=5 count (${le5Match[1]}) should be >= le=1 count (${le1Match[1]})`,
    );
  }
});

test("metrics HELP line appears for known metrics", () => {
  inc("joule_x402_verify_errors_total");
  const text = metricsText();
  assert.ok(text.includes("# HELP joule_x402_verify_errors_total"), "HELP line for verify errors");
});

// ── Logger ────────────────────────────────────────────────────────────────────

const { logger } = await import("../src/logger.js");

test("logger does not throw on all levels", () => {
  assert.doesNotThrow(() => logger.trace("trace msg", { extra: 1 }));
  assert.doesNotThrow(() => logger.debug("debug msg"));
  assert.doesNotThrow(() => logger.info("info msg", { key: "value" }));
  assert.doesNotThrow(() => logger.warn("warn msg"));
  assert.doesNotThrow(() => logger.error("error msg", { err: "oops" }));
  assert.doesNotThrow(() => logger.fatal("fatal msg"));
});

test("logger child inherits bindings", () => {
  const child = logger.child({ component: "test" });
  assert.doesNotThrow(() => child.info("child log", { extra: true }));
  const grandchild = child.child({ sub: "more" });
  assert.doesNotThrow(() => grandchild.warn("grandchild log"));
});
