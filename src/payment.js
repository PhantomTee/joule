// Real x402 settlement on Circle Arc via @circle-fin/x402-batching.
// No mock: the server verifies and settles every pull against the Gateway
// facilitator, mirroring the scaffold's lib/x402.ts approach.
//
// Hardening: verify is a single attempt (bad signature = hard failure).
// Settle retries up to 3 times with exponential backoff (100 → 400 → 1600 ms)
// to survive transient Gateway/RPC hiccups.

import { config } from "./config.js";
import { inc, observe } from "./metrics.js";
import { logger } from "./logger.js";

// Settle attempts: initial + up to 3 retries. Delays between attempts (ms).
const SETTLE_RETRY_DELAYS = [100, 400, 1600];

// These errorReasons are definitive rejections — don't burn retries on them.
const NON_RETRIABLE = new Set(["insufficient_funds", "signature_mismatch", "already_settled", "expired"]);

// Build x402 "exact" payment requirements for an amount in atomic USDC (6 dp).
// `payTo` defaults to this node's own seller address, but callers settling on
// behalf of someone else (e.g. the coordinator paying out a specific lite
// worker) can override it per call.
export function buildRequirements(amountAtomic, { endpoint, payTo } = {}) {
  return {
    scheme: "exact",
    network: config.arc.network,
    asset: config.arc.usdc,
    amount: String(amountAtomic),
    payTo: payTo || config.sellerAddress,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: config.arc.gatewayWallet,
    },
  };
}

function decodeSignature(header) {
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// Lazily construct the real facilitator so unit tests of pure logic don't need the SDK.
let facilitatorPromise = null;

async function getFacilitator() {
  if (!facilitatorPromise) {
    facilitatorPromise = (async () => {
      const { BatchFacilitatorClient } = await import(
        "@circle-fin/x402-batching/server"
      );
      return new BatchFacilitatorClient();
    })();
  }
  return facilitatorPromise;
}

/**
 * Verify + settle a payment for `amountAtomic` USDC.
 * Verify is single-attempt (hard failure on bad signature).
 * Settle retries on transient errors with exponential backoff.
 * @returns {Promise<{settled:boolean, status:number, payer?:string, transaction?:string, reason?:string}>}
 */
export async function charge({ signatureHeader, amountAtomic, endpoint, payTo }) {
  const requirements = buildRequirements(amountAtomic, { endpoint, payTo });

  if (!signatureHeader) {
    return { settled: false, status: 402, requirements };
  }

  const payload = decodeSignature(signatureHeader);
  if (!payload) {
    return { settled: false, status: 402, reason: "malformed_signature", requirements };
  }

  if (!requirements.payTo) {
    return { settled: false, status: 402, reason: "no_payout_wallet", requirements };
  }

  const facilitator = await getFacilitator();
  const t0 = Date.now();

  // ── Verify (no retry — invalid signature is a hard failure) ──────────────
  const verifyResult = await facilitator.verify(payload, requirements);
  if (!verifyResult.isValid) {
    inc("joule_x402_verify_errors_total");
    logger.warn("x402 verify failed", { endpoint, reason: verifyResult.invalidReason });
    return {
      settled: false,
      status: 402,
      reason: verifyResult.invalidReason ?? "verification_failed",
      requirements,
    };
  }

  // ── Settle with retry (up to 3 attempts on transient failures) ───────────
  let settleResult = null;
  let lastReason = "settlement_failed";

  for (let attempt = 0; attempt <= SETTLE_RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      inc("joule_x402_retries_total");
      logger.warn("x402 settle retry", { endpoint, attempt, lastReason });
      await new Promise((r) => setTimeout(r, SETTLE_RETRY_DELAYS[attempt - 1]));
    }
    try {
      settleResult = await facilitator.settle(payload, requirements);
      if (settleResult.success) break;
      lastReason = settleResult.errorReason ?? "settlement_failed";
      if (NON_RETRIABLE.has(lastReason)) break;
    } catch (err) {
      lastReason = err.message ?? "settle_threw";
      if (attempt === SETTLE_RETRY_DELAYS.length) {
        logger.error("x402 settle threw after all retries", { endpoint, err: lastReason });
        throw err;
      }
    }
  }

  const latencyMs = Date.now() - t0;
  observe("joule_payment_settlement_latency_ms", latencyMs);

  if (!settleResult?.success) {
    logger.error("x402 settle failed", { endpoint, reason: lastReason, latencyMs });
    return {
      settled: false,
      status: 402,
      reason: lastReason,
      requirements,
    };
  }

  logger.info("x402 settled", {
    endpoint,
    amountAtomic,
    tx: settleResult.transaction ?? "?",
    latencyMs,
  });

  return {
    settled: true,
    status: 200,
    payer: settleResult.payer ?? verifyResult.payer ?? "unknown",
    transaction: settleResult.transaction ?? null,
    amountAtomic,
  };
}

// Encode payment requirements into the base64 PAYMENT-REQUIRED header value.
export function paymentRequiredHeader(requirements, endpoint) {
  const body = {
    x402Version: 2,
    resource: {
      url: endpoint,
      description: `Pay-per-second inference (${(
        Number(requirements.amount) / 1e6
      ).toFixed(6)} USDC this interval)`,
      mimeType: "application/json",
    },
    accepts: [requirements],
  };
  return Buffer.from(JSON.stringify(body)).toString("base64");
}
