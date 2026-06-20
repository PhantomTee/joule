// The provider's pricing agent. It sets its own per-second price instead of using
// a fixed rate: it surges when busy (scarce capacity) and discounts when the
// machine is truly idle (spare capacity it wants to sell). This is the supply side
// of the agent-to-agent market — the counterpart to the buyer agent's budget logic.

import { config } from "./config.js";

export class PricingAgent {
  constructor({ base = config.pricePerSecondUsdc } = {}) {
    this.base = base;
    this.floor = base * 0.5;
    this.ceil = base * 4;
  }

  /**
   * Quote a per-second price given current demand.
   * @param state { activeSessions:number, idleSeconds:number }
   * @returns { price, base, multiplier, reason }
   */
  quote(state = {}) {
    const active = state.activeSessions ?? 0;
    const idle = state.idleSeconds ?? 0;

    let mult = 1 + 0.5 * active; // each concurrent job makes capacity scarcer
    let reason =
      active > 0 ? `${active} job(s) in flight → ${mult.toFixed(2)}x surge` : "open capacity at base rate";

    if (active === 0 && idle >= config.idleThresholdSeconds) {
      mult *= 0.7; // truly idle: discount to attract work
      const idleLabel = idle > 86400 ? "idle" : `idle ${idle}s`;
      reason = `machine ${idleLabel} → 0.7x discount to attract work`;
    }

    let price = Math.min(Math.max(this.base * mult, this.floor), this.ceil);
    price = Number(price.toFixed(6));
    return { price, base: this.base, multiplier: Number((price / this.base).toFixed(2)), reason };
  }
}
