#!/usr/bin/env node
// npm run provider-status [-- --port 19131]
// Shows this node's live status: /stats, /healthz, registry entry (if PROVIDER_ID set).

const port = (() => {
  const i = process.argv.indexOf("--port");
  return i !== -1 ? Number(process.argv[i + 1]) : (Number(process.env.PORT) || 19131);
})();

const base = `http://localhost:${port}`;

async function json(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

function kv(label, value, unit = "") {
  const l = label.padEnd(26);
  process.stdout.write(`  ${l}${value}${unit}\n`);
}

async function main() {
  const hr = "─".repeat(60);
  process.stdout.write(`\n${hr}\n`);
  process.stdout.write(` JOULE PROVIDER STATUS   port ${port}\n`);
  process.stdout.write(`${hr}\n`);

  const [stats, health] = await Promise.all([
    json(`${base}/stats`),
    json(`${base}/healthz`),
  ]);

  if (!health && !stats) {
    process.stdout.write(" ✗ Node not reachable — is it running? (npm start)\n");
    process.stdout.write(`${hr}\n\n`);
    process.exit(1);
  }

  // Health
  if (health) {
    process.stdout.write("\n HEALTH\n");
    kv("model", health.model || "—");
    kv("inference", health.inferenceBase || "—");
    kv("idle seconds", health.idleSeconds != null ? health.idleSeconds.toFixed(0) : "—", "s");
    kv("gpu", health.gpu?.present ? `${health.gpu.name || "GPU"} ${health.gpu.tempC ? `${health.gpu.tempC}°C` : ""}` : "no GPU");
    kv("live price", health.pricePerSecond != null ? health.pricePerSecond.toFixed(6) : "—", " USDC/sec");
  }

  // Earnings
  if (stats?.earnings) {
    const e = stats.earnings;
    process.stdout.write("\n EARNINGS\n");
    kv("total USDC earned", (e.totalUsdc || 0).toFixed(6), " USDC");
    kv("total seconds billed", (e.totalSeconds || 0).toLocaleString(), "s");
    kv("total jobs", e.jobs || 0);
  }

  // Active sessions
  if (stats != null) {
    process.stdout.write("\n SESSIONS\n");
    kv("active sessions", stats.activeSessions ?? 0);
    if (stats.pricing) {
      kv("current price", (stats.pricing.usdcPerSecond || 0).toFixed(6), " USDC/sec");
      kv("price multiplier", stats.pricing.multiplier != null ? `${stats.pricing.multiplier}×` : "—");
      if (stats.pricing.reason) {
        process.stdout.write(`  ${"reason".padEnd(26)}${stats.pricing.reason}\n`);
      }
    }
  }

  // Metrics
  const metricsUrl = `${base}/metrics`;
  const metricsText = await fetch(metricsUrl, { signal: AbortSignal.timeout(3000) }).then((r) => r.text()).catch(() => null);
  if (metricsText) {
    const extract = (name) => {
      const m = metricsText.match(new RegExp(`^${name}\\s+(\\S+)`, "m"));
      return m ? m[1] : null;
    };
    process.stdout.write("\n PROMETHEUS METRICS\n");
    const settledCount = extract("joule_sessions_total\\{outcome=\"completed\"\\}");
    const openedCount  = extract("joule_sessions_total\\{outcome=\"opened\"\\}");
    if (settledCount != null) kv("sessions completed", settledCount);
    if (openedCount  != null) kv("sessions opened",    openedCount);
    const verifyErrors = extract("joule_x402_verify_errors_total");
    if (verifyErrors != null) kv("x402 verify errors", verifyErrors);
    const retries = extract("joule_x402_retries_total");
    if (retries != null) kv("x402 settle retries", retries);
  }

  // On-chain registry
  const providerId = process.env.PROVIDER_ID;
  const registryAddr = process.env.REGISTRY_ADDRESS;
  if (providerId && registryAddr) {
    const regData = await json(`${base}/api/providers/${providerId}`);
    if (regData?.provider) {
      const p = regData.provider;
      process.stdout.write("\n ON-CHAIN REGISTRY\n");
      kv("provider id", p.id);
      kv("contract", registryAddr);
      kv("wallet", p.walletAddress);
      kv("model", p.modelName);
      kv("total on-chain earnings", (p.reputation?.totalRevenue || 0).toFixed(6), " USDC");
      kv("total sessions reported", p.reputation?.totalSessions || 0);
      kv("avg latency (EMA)", p.reputation?.avgLatencyMs != null ? `${p.reputation.avgLatencyMs} ms` : "—");
      kv("error rate", p.reputation?.errorRatePpm != null ? `${p.reputation.errorRatePpm} ppm` : "—");
    }
  } else {
    process.stdout.write("\n ON-CHAIN REGISTRY\n");
    process.stdout.write("  PROVIDER_ID or REGISTRY_ADDRESS not set — run npm run provider:register\n");
  }

  process.stdout.write(`\n${hr}\n\n`);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
