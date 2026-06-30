// Hourly on-chain metric reporter for InferenceProviderRegistry.sol.
// Attached to the Earnings ledger: accumulates session data between flushes,
// then calls reportMetrics() once per hour (or when earnings >= $0.001).
//
// Usage: imported by src/server.js — call startReporter(earnings) at startup.

import { reportMetrics } from "./registry.js";
import { usdcToAtomic } from "./config.js";

const FLUSH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MIN_EARN_USDC_TO_FLUSH = 0.001;      // avoid dust spam
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 2000;

// Accumulator reset on each successful flush
let acc = {
  secondsRun: 0,
  earnedUsdc: 0,  // USDC (float)
  errorCount: 0,
  latencySamples: [],
  since: Date.now(),
};

/** Call this whenever a session settles in earnings.js. */
export function accumulateSession({ seconds = 0, amountUsdc = 0, latencyMs = null, error = false }) {
  acc.secondsRun  += seconds;
  acc.earnedUsdc  += amountUsdc;
  if (error) acc.errorCount++;
  if (latencyMs != null) acc.latencySamples.push(latencyMs);
}

async function flush(providerId) {
  if (!process.env.REGISTRY_ADDRESS || !process.env.SELLER_PRIVATE_KEY) return;
  if (!providerId) return;

  const earned = acc.earnedUsdc;
  if (earned < MIN_EARN_USDC_TO_FLUSH && acc.secondsRun < 60) return; // not enough to bother

  const avgLatency = acc.latencySamples.length
    ? Math.round(acc.latencySamples.reduce((a, b) => a + b, 0) / acc.latencySamples.length)
    : 0;

  const payload = {
    providerId,
    secondsRun:   acc.secondsRun,
    earnedUsdc:   usdcToAtomic(earned),
    errorCount:   acc.errorCount,
    avgLatencyMs: avgLatency,
  };

  // Reset immediately so new sessions accumulate into the next window
  acc = { secondsRun: 0, earnedUsdc: 0, errorCount: 0, latencySamples: [], since: Date.now() };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const txHash = await reportMetrics(payload);
      console.log(`[registry] metrics reported  tx=${txHash}  earned=${earned.toFixed(6)} USDC  seconds=${payload.secondsRun}`);
      return;
    } catch (err) {
      const wait = RETRY_BASE_MS * 2 ** attempt;
      console.warn(`[registry] reportMetrics attempt ${attempt + 1}/${MAX_RETRIES} failed: ${err.message}  retry in ${wait}ms`);
      if (attempt < MAX_RETRIES - 1) await new Promise((r) => setTimeout(r, wait));
      else console.error("[registry] all retries exhausted — metrics NOT reported this window");
    }
  }
}

/**
 * Start the hourly reporter.
 * @param {string|number} providerId  as returned by scripts/register-provider.mjs
 */
export function startReporter(providerId) {
  if (!process.env.REGISTRY_ADDRESS) {
    console.log("[registry] REGISTRY_ADDRESS not set — on-chain reporting disabled");
    return;
  }
  if (!process.env.PROVIDER_ID && !providerId) {
    console.log("[registry] PROVIDER_ID not set — on-chain reporting disabled");
    return;
  }
  const id = providerId || process.env.PROVIDER_ID;
  console.log(`[registry] hourly reporter active  providerId=${id}  registry=${process.env.REGISTRY_ADDRESS}`);
  const timer = setInterval(() => flush(id), FLUSH_INTERVAL_MS);
  timer.unref?.(); // don't prevent clean shutdown
}
