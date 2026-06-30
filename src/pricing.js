// The provider's pricing agent — multi-factor, self-narrating.
//
// Factors applied in order, all multiplicative on the base price:
//   1. Demand surge      — each active session raises scarcity
//   2. Idle discount     — truly idle machine wants to attract work
//   3. Time-of-day       — peak UTC 9–17 +20 %, off-peak −15 %
//   4. GPU temperature   — hot GPU costs more (thermal headroom), cool = spare capacity
//   5. Model size        — larger model → higher base multiplier
//   6. Predictive surge  — if queue is growing in the last 30s, pre-empt demand
//
// The agent narrates every decision: "Temp 78°C + 2 sessions → 1.92x surge"
// so the buyer knows exactly why they're being quoted a given rate.

import { config } from "./config.js";

// Model-size hints parsed from model name string.
// Override with MODEL_PRICE_MULT env var for custom multipliers.
const MODEL_SIZES = [
  { pattern: /70b|65b|34b/i,  mult: 4.0, label: "XL" },
  { pattern: /13b|14b|20b/i,  mult: 2.5, label: "L"  },
  { pattern: /7b|8b|9b/i,     mult: 2.0, label: "M"  },
  { pattern: /3b|4b/i,        mult: 1.4, label: "S+"  },
  { pattern: /1b|1\.5b/i,     mult: 0.9, label: "S"   },
  { pattern: /0\.5b|500m/i,   mult: 0.7, label: "XS"  },
];

function modelMult(model) {
  const envMult = Number(process.env.MODEL_PRICE_MULT);
  if (envMult > 0) return { mult: envMult, label: `custom ×${envMult}` };
  const m = String(model || "").toLowerCase();
  for (const { pattern, mult, label } of MODEL_SIZES) {
    if (pattern.test(m)) return { mult, label: `${label} model ×${mult}` };
  }
  return { mult: 1, label: null };
}

// UTC hour → time-of-day multiplier.
//   Peak    (09:00–17:00 UTC): +20 % — high API demand window
//   Off-peak (17:00–09:00 UTC): −15 % — spare capacity discount
function timeOfDayMult() {
  const h = new Date().getUTCHours();
  if (h >= 9 && h < 17) return { mult: 1.20, label: "peak UTC 09–17 +20%" };
  return { mult: 0.85, label: "off-peak −15%" };
}

// GPU temperature multiplier.
//   > 80 °C: hot — raise price to limit inbound jobs and reduce thermal stress
//   < 30 °C: cold / idle — capacity to spare, discount to attract work
function gpuTempMult(gpu) {
  if (!gpu?.present) return { mult: 1, label: null };
  const t = gpu.tempC ?? 0;
  if (t > 80) return { mult: 1.50, label: `GPU ${t}°C >80 +50%` };
  if (t > 70) return { mult: 1.20, label: `GPU ${t}°C warm +20%` };
  if (t < 30) return { mult: 0.70, label: `GPU ${t}°C cold −30%` };
  return { mult: 1, label: null };
}

export class PricingAgent {
  constructor({ base = config.pricePerSecondUsdc, model = config.model } = {}) {
    this.base  = base;
    this.model = model;
    this.floor = base * 0.40; // never below 40 % of base (covers operating costs)
    this.ceil  = base * 6.00; // never above 6× (keeps buyers from abandoning)
    // Ring buffer of { t: timestamp, n: activeSessions } for trend detection
    this._history = [];
  }

  /** Record a demand sample (call every few seconds from the server tick). */
  record(activeSessions) {
    this._history.push({ t: Date.now(), n: activeSessions });
    if (this._history.length > 60) this._history.shift(); // keep ~2 min of history
  }

  /** Detect if the queue is growing (returns delta sessions/10s, positive = growing). */
  _queueTrend() {
    const now = Date.now();
    const recent = this._history.filter((h) => now - h.t <  15_000);
    const prior  = this._history.filter((h) => now - h.t >= 15_000 && now - h.t < 30_000);
    if (!recent.length || !prior.length) return 0;
    const avg = (arr) => arr.reduce((s, h) => s + h.n, 0) / arr.length;
    return avg(recent) - avg(prior);
  }

  /**
   * Quote a per-second price given live demand and system state.
   *
   * @param state {
   *   activeSessions: number,
   *   idleSeconds:    number,
   *   gpu:            object,   // from sysmon.gpuStats()
   *   model:          string,
   * }
   * @returns { price, base, multiplier, reason, breakdown }
   */
  quote(state = {}) {
    const active = state.activeSessions ?? 0;
    const idle   = state.idleSeconds   ?? 0;
    const gpu    = state.gpu           ?? null;
    const model  = state.model         ?? this.model;

    const factors = [];
    let mult = 1;

    // ── 1. Demand surge ───────────────────────────────────────────────────────
    if (active > 0) {
      const m = 1 + 0.5 * active;
      mult *= m;
      factors.push(`${active} session(s) →${m.toFixed(2)}x`);
    } else {
      factors.push("open capacity");
    }

    // ── 2. Idle discount ──────────────────────────────────────────────────────
    if (active === 0 && idle >= config.idleThresholdSeconds) {
      mult *= 0.70;
      const label = idle > 86400 ? "machine idle" : `idle ${Math.round(idle)}s`;
      factors.push(`${label} →0.7x discount`);
    }

    // ── 3. Time of day ────────────────────────────────────────────────────────
    const tod = timeOfDayMult();
    mult *= tod.mult;
    factors.push(tod.label);

    // ── 4. GPU temperature ────────────────────────────────────────────────────
    const gpuF = gpuTempMult(gpu);
    mult *= gpuF.mult;
    if (gpuF.label) factors.push(gpuF.label);

    // ── 5. Model size ─────────────────────────────────────────────────────────
    const modF = modelMult(model);
    mult *= modF.mult;
    if (modF.label) factors.push(modF.label);

    // ── 6. Predictive surge ───────────────────────────────────────────────────
    const trend = this._queueTrend();
    if (trend > 0.3) {
      const trendMult = 1 + Math.min(trend * 0.10, 0.25); // cap at +25%
      mult *= trendMult;
      factors.push(`queue growing +${trend.toFixed(1)} →+${Math.round((trendMult - 1) * 100)}%`);
    }

    let price = Math.min(Math.max(this.base * mult, this.floor), this.ceil);
    price = Number(price.toFixed(6));

    return {
      price,
      base:       this.base,
      multiplier: Number((price / this.base).toFixed(3)),
      reason:     factors.filter(Boolean).join(" · "),
      breakdown: {
        activeSessions: active,
        idleSeconds:    idle,
        gpuFactor:      gpuF.label,
        todFactor:      tod.label,
        modelFactor:    modF.label,
        trendDelta:     Number(trend.toFixed(2)),
        clampedToFloor: price === this.floor,
        clampedToCeil:  price === this.ceil,
      },
    };
  }
}
