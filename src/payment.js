// Real x402 settlement on Circle Arc via @circle-fin/x402-batching.
// No mock: the server verifies and settles every pull against the Gateway
// facilitator, mirroring the scaffold's lib/x402.ts approach.

import { config } from "./config.js";

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

  const verifyResult = await facilitator.verify(payload, requirements);
  if (!verifyResult.isValid) {
    console.error(`[payment] verify failed for ${endpoint}:`, JSON.stringify(verifyResult));
    return {
      settled: false,
      status: 402,
      reason: verifyResult.invalidReason ?? "verification_failed",
      requirements,
    };
  }

  const settleResult = await facilitator.settle(payload, requirements);
  if (!settleResult.success) {
    console.error(`[payment] settle failed for ${endpoint}:`, JSON.stringify(settleResult));
    return {
      settled: false,
      status: 402,
      reason: settleResult.errorReason ?? "settlement_failed",
      requirements,
    };
  }
  console.log(`[payment] settled ${endpoint}: ${amountAtomic} atomic USDC, tx ${settleResult.transaction ?? "?"}`);

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
