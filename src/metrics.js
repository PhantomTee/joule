// Prometheus text exposition format (no external deps).
// Exposes counters and histograms at GET /metrics for Prometheus/Grafana scraping.
//
// Metrics tracked:
//   joule_sessions_total{outcome}          — sessions opened / completed / reaped
//   joule_provider_seconds_billed_total    — cumulative inference-seconds billed
//   joule_provider_usdc_earned_total       — cumulative USDC earned
//   joule_session_duration_seconds         — per-pull billed-seconds histogram
//   joule_payment_settlement_latency_ms    — verify+settle round-trip histogram
//   joule_x402_verify_errors_total         — x402 signature verification failures
//   joule_x402_retries_total               — settlement retry attempts

const HELP = {
  joule_sessions_total:                  "Total inference sessions by outcome",
  joule_provider_seconds_billed_total:   "Cumulative inference seconds billed to buyers",
  joule_provider_usdc_earned_total:      "Cumulative USDC earned from inference (normalized)",
  joule_session_duration_seconds:        "Per-pull billed duration in seconds (histogram)",
  joule_payment_settlement_latency_ms:   "x402 verify+settle round-trip latency in ms (histogram)",
  joule_x402_verify_errors_total:        "x402 payment verification failures",
  joule_x402_retries_total:              "x402 settlement retry attempts",
};

const HISTOGRAM_BUCKETS = {
  joule_session_duration_seconds:      [1, 5, 10, 30, 60, 120, 300],
  joule_payment_settlement_latency_ms: [50, 100, 250, 500, 1000, 2500, 5000],
};

// counters: string (serialised key) -> number
const counters = new Map();
// histograms: name -> { sum, count, buckets: Map<le, count> }
const histograms = new Map();

function labelStr(labels) {
  const keys = Object.keys(labels);
  if (!keys.length) return "";
  return `{${keys.map((k) => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`).join(",")}}`;
}

export function inc(name, labels = {}, amount = 1) {
  const key = name + labelStr(labels);
  counters.set(key, (counters.get(key) ?? 0) + amount);
}

export function observe(name, value) {
  if (!histograms.has(name)) {
    const les = [...(HISTOGRAM_BUCKETS[name] ?? [0.1, 0.5, 1, 5, 10]), Infinity];
    histograms.set(name, {
      sum: 0,
      count: 0,
      buckets: new Map(les.map((le) => [le, 0])),
    });
  }
  const h = histograms.get(name);
  h.sum   += value;
  h.count += 1;
  for (const le of h.buckets.keys()) {
    if (value <= le) h.buckets.set(le, h.buckets.get(le) + 1);
  }
}

export function metricsText() {
  const lines = [];

  // ── counters ────────────────────────────────────────────────────────────────
  const countersByName = new Map();
  for (const [key, val] of counters) {
    const name = key.split("{")[0];
    if (!countersByName.has(name)) countersByName.set(name, []);
    countersByName.get(name).push([key, val]);
  }
  for (const [name, entries] of countersByName) {
    if (HELP[name]) lines.push(`# HELP ${name} ${HELP[name]}`);
    lines.push(`# TYPE ${name} counter`);
    for (const [key, val] of entries) lines.push(`${key} ${val}`);
  }

  // ── histograms ───────────────────────────────────────────────────────────────
  for (const [name, h] of histograms) {
    if (HELP[name]) lines.push(`# HELP ${name} ${HELP[name]}`);
    lines.push(`# TYPE ${name} histogram`);
    for (const [le, count] of h.buckets) {
      const leStr = le === Infinity ? "+Inf" : String(le);
      lines.push(`${name}_bucket{le="${leStr}"} ${count}`);
    }
    lines.push(`${name}_sum ${h.sum}`);
    lines.push(`${name}_count ${h.count}`);
  }

  return lines.join("\n") + "\n";
}
