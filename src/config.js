// Central configuration, sourced from environment with sane defaults.
// No external deps: we read process.env directly and coerce types here.

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

export const config = {
  // --- HTTP sidecar ---
  port: num(process.env.PORT, 19131),
  // Inference backend: any OpenAI-compatible server.
  //   * Qwen llamafile  -> http://localhost:8080  (default; single-file, no install)
  //   * Ollama          -> http://localhost:11434
  //   * hosted (Groq/OpenAI/Together) -> their base URL + INFERENCE_API_KEY
  inferenceBase:
    process.env.INFERENCE_BASE || process.env.OLLAMA_BASE || "http://localhost:8080",
  inferenceApiKey: process.env.INFERENCE_API_KEY || "",
  model: process.env.MODEL || "qwen2.5-0.5b-instruct",

  // --- Pricing (USDC, 6-decimal asset on Arc) ---
  // Per-second is the headline RFB 4 meter; token components are optional add-ons.
  pricePerSecondUsdc: num(process.env.PRICE_USDC_PER_SECOND, 0.0002),
  // Each paid "pull" entitles the buyer to one tick of streaming. Kept fixed so the
  // 402 amount is deterministic across the client's sign-and-retry round trip.
  tickSeconds: num(process.env.PRICE_TICK_SECONDS, 1),
  pricePerInputTokenUsdc: num(process.env.PRICE_USDC_PER_INPUT_TOKEN, 0),
  pricePerOutputTokenUsdc: num(process.env.PRICE_USDC_PER_OUTPUT_TOKEN, 0),
  minChargeUsdc: num(process.env.MIN_CHARGE_USDC, 0.000001), // Circle nanopayment floor
  maxSessionSeconds: num(process.env.MAX_SESSION_SECONDS, 600),
  // A buyer must pay (pull) at least this often or the session is reaped — this is
  // what makes "tap to stop" save compute: stop paying and the model is freed.
  pullGraceSeconds: num(process.env.PULL_GRACE_SECONDS, 8),

  // --- Idle gating: only serve when the machine is idle enough ---
  requireIdle: bool(process.env.REQUIRE_IDLE, false),
  idleThresholdSeconds: num(process.env.IDLE_THRESHOLD_SECONDS, 60),

  // --- Payment backend: real Circle x402 on Arc (no mock) ---
  // Settlement uses @circle-fin/x402-batching BatchFacilitatorClient. Requires the
  // SDK installed and SELLER_ADDRESS set; payments land in the seller Gateway balance.
  sellerAddress: process.env.SELLER_ADDRESS || "",
  chain: process.env.ARC_CHAIN || "arcTestnet",
  // x402 authorization validity window the buyer signs over (validBefore = now + this).
  // The hosted facilitator enforces a minimum; 30 days is comfortably above it.
  maxTimeoutSeconds: num(process.env.MAX_TIMEOUT_SECONDS, 2_592_000),

  // --- Arc testnet constants (verified against Circle docs + scaffold) ---
  arc: {
    network: "eip155:5042002",
    usdc: "0x3600000000000000000000000000000000000000", // 6-decimal ERC-20 interface
    gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    explorer: "https://testnet.arcscan.app",
  },

  // --- Storage ---
  earningsFile: process.env.EARNINGS_FILE || "./data/earnings.jsonl",

  // --- Network ---
  // The shared, always-on Joule network directory. Every node joins this by
  // default — nobody needs to host or set a coordinator just to be discoverable.
  // Set COORDINATOR_URL to point at a different one, or "off" to run solo.
  defaultCoordinatorUrl: "https://joule-coordinator.onrender.com",
};

// USDC has 6 decimals on Arc's ERC-20 interface.
export const USDC_DECIMALS = 6;
export const usdcToAtomic = (usd) => Math.round(usd * 10 ** USDC_DECIMALS);
export const atomicToUsdc = (atomic) => Number(atomic) / 10 ** USDC_DECIMALS;
