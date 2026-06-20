// Per-second / per-token metering for a single streaming inference session.
// This is the heart of RFB 4 (pay-per-second + tap-to-stop): we accrue cost as
// wall-clock seconds elapse and tokens stream, and can stop and settle the exact
// amount consumed at any instant.

import { config, usdcToAtomic } from "./config.js";

export class Meter {
  constructor({
    pricePerSecondUsdc = config.pricePerSecondUsdc,
    pricePerInputTokenUsdc = config.pricePerInputTokenUsdc,
    pricePerOutputTokenUsdc = config.pricePerOutputTokenUsdc,
  } = {}) {
    this.pricePerSecondUsdc = pricePerSecondUsdc;
    this.pricePerInputTokenUsdc = pricePerInputTokenUsdc;
    this.pricePerOutputTokenUsdc = pricePerOutputTokenUsdc;
    this.startedAt = null;
    this.stoppedAt = null;
    this.lastBilledAt = null; // advances each settled pull
    this.inputTokens = 0;
    this.outputTokens = 0;
  }

  start() {
    this.startedAt = Date.now();
    this.lastBilledAt = this.startedAt;
    return this;
  }

  stop() {
    if (this.stoppedAt === null) this.stoppedAt = Date.now();
    return this;
  }

  addInputTokens(n) {
    this.inputTokens += n;
  }

  addOutputTokens(n) {
    this.outputTokens += n;
  }

  elapsedSeconds(at = Date.now()) {
    if (this.startedAt === null) return 0;
    const end = this.stoppedAt ?? at;
    return Math.max(0, (end - this.startedAt) / 1000);
  }

  // Cost in whole USDC accrued so far (or at stop time).
  costUsdc(at = Date.now()) {
    const seconds = this.elapsedSeconds(at);
    return (
      seconds * this.pricePerSecondUsdc +
      this.inputTokens * this.pricePerInputTokenUsdc +
      this.outputTokens * this.pricePerOutputTokenUsdc
    );
  }

  // Cost in atomic USDC units (6 decimals), the unit x402/Gateway settles in.
  costAtomic(at = Date.now()) {
    const atomic = usdcToAtomic(this.costUsdc(at));
    const floor = usdcToAtomic(config.minChargeUsdc);
    return Math.max(atomic, this.elapsedSeconds(at) > 0 ? floor : 0);
  }

  // Atomic USDC owed for the interval since the last settled pull, WITHOUT advancing.
  // Used to build the 402 challenge amount for the next pull.
  pendingIntervalAtomic(at = Date.now()) {
    const base = this.lastBilledAt ?? this.startedAt ?? at;
    const seconds = Math.max(0, (at - base) / 1000);
    const usd = seconds * this.pricePerSecondUsdc;
    const atomic = usdcToAtomic(usd);
    const floor = usdcToAtomic(config.minChargeUsdc);
    // Always quote at least the nanopayment floor so an opening pull is never $0.
    return Math.max(atomic, floor);
  }

  // Marks the current interval as billed and advances the billing cursor.
  commitInterval(at = Date.now()) {
    const billed = this.pendingIntervalAtomic(at);
    this.lastBilledAt = at;
    return billed;
  }

  snapshot(at = Date.now()) {
    return {
      seconds: Number(this.elapsedSeconds(at).toFixed(3)),
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      costUsdc: Number(this.costUsdc(at).toFixed(6)),
      costAtomic: this.costAtomic(at),
      stopped: this.stoppedAt !== null,
    };
  }
}

// Upfront price quote for the 402 challenge: what a full-length session could cost.
export function quoteMaxUsdc(maxSeconds = config.maxSessionSeconds) {
  return Number((maxSeconds * config.pricePerSecondUsdc).toFixed(6));
}
