// Cryptographic binding of model + prompt + output per inference session.
// The provider signs with their Ethereum private key (SELLER_PRIVATE_KEY);
// buyers verify against the provider's public address (from the agent card).
//
// Attestation format (v1):
//   message = "joule-attestation-v1" + "\x00" + model + "\x00"
//             + sha256(prompt) + "\x00" + sha256(output) + "\x00" + timestamp
//   signature = personalSign(keccak256(message), SELLER_PRIVATE_KEY)
//
// The full attestation object is included in the x-inference-attestation
// response header (base64-encoded JSON) so buyers can verify off-band.

import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// ── Hashing helpers ───────────────────────────────────────────────────────────

export function sha256Hex(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

// ── Signing (provider side, requires SELLER_PRIVATE_KEY) ─────────────────────

let _signerAccount = null;
async function getSignerAccount() {
  if (_signerAccount) return _signerAccount;
  const pk = process.env.SELLER_PRIVATE_KEY;
  if (!pk) return null;
  const { privateKeyToAccount } = await import("viem/accounts");
  _signerAccount = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
  return _signerAccount;
}

/**
 * Build the canonical attestation message (what gets signed).
 * Deterministic and verifiable by any third party given model/prompt/output/ts.
 */
function attestationMessage(model, promptHash, outputHash, timestamp) {
  return `joule-attestation-v1\x00${model}\x00${promptHash}\x00${outputHash}\x00${timestamp}`;
}

/**
 * Create and sign an attestation for a completed inference.
 * @returns {Promise<object|null>} Attestation object, or null if key not available
 */
export async function createAttestation({ model, prompt, output, sessionId }) {
  const account = await getSignerAccount();
  if (!account) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const promptHash = sha256Hex(prompt);
  const outputHash = sha256Hex(output);
  const message    = attestationMessage(model, promptHash, outputHash, timestamp);

  let signature;
  try {
    // EIP-191 personal sign — standard Ethereum message signing
    signature = await account.signMessage({ message });
  } catch {
    return null;
  }

  const attestation = {
    v:          1,
    sessionId:  sessionId ?? null,
    model,
    promptHash,
    outputHash,
    timestamp,
    signer:     account.address,
    signature,
  };

  // Fire-and-forget append to local ledger (non-blocking)
  appendToLedger(attestation).catch(() => {});

  return attestation;
}

// ── Verification (buyer side) ─────────────────────────────────────────────────

/**
 * Verify an attestation object against the known provider address.
 * @param {object} attestation  As returned by createAttestation / from response header
 * @param {string} expectedPrompt   The prompt the buyer sent
 * @param {string} expectedOutput   The output the buyer received
 * @param {string} expectedSigner   The provider's wallet address (from agent card)
 * @returns {Promise<{ok:boolean, reason:string}>}
 */
export async function verifyAttestation(attestation, expectedPrompt, expectedOutput, expectedSigner) {
  if (!attestation) return { ok: false, reason: "no attestation" };
  if (attestation.v !== 1) return { ok: false, reason: `unknown attestation version ${attestation.v}` };

  // Check hashes match what the buyer actually received
  const computedPromptHash = sha256Hex(expectedPrompt);
  const computedOutputHash = sha256Hex(expectedOutput);
  if (computedPromptHash !== attestation.promptHash) {
    return { ok: false, reason: "prompt hash mismatch — output may be from a different prompt" };
  }
  if (computedOutputHash !== attestation.outputHash) {
    return { ok: false, reason: "output hash mismatch — content was altered after signing" };
  }

  // Reconstruct the message and recover the signer
  const message = attestationMessage(attestation.model, attestation.promptHash, attestation.outputHash, attestation.timestamp);
  try {
    const { verifyMessage } = await import("viem");
    const valid = await verifyMessage({
      address:   expectedSigner,
      message,
      signature: attestation.signature,
    });
    if (!valid) return { ok: false, reason: `signature invalid — expected signer ${expectedSigner}` };
  } catch (err) {
    return { ok: false, reason: `signature check threw: ${err.message}` };
  }

  // Timestamp freshness check (accept up to 10 min old — streaming can be slow)
  const ageSeconds = Math.floor(Date.now() / 1000) - attestation.timestamp;
  if (ageSeconds > 600) {
    return { ok: false, reason: `attestation too old (${ageSeconds}s) — possible replay` };
  }

  return { ok: true, reason: "verified" };
}

/**
 * Parse an x-inference-attestation header value (base64-encoded JSON).
 * Returns null on parse failure — callers treat missing attestation as unverified.
 */
export function parseAttestationHeader(headerValue) {
  if (!headerValue) return null;
  try {
    return JSON.parse(Buffer.from(headerValue, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Encode an attestation object for the x-inference-attestation response header.
 */
export function encodeAttestationHeader(attestation) {
  return Buffer.from(JSON.stringify(attestation)).toString("base64");
}

// ── Local ledger ──────────────────────────────────────────────────────────────

const LEDGER = resolve("data/attestations.jsonl");
async function appendToLedger(entry) {
  await mkdir(dirname(LEDGER), { recursive: true });
  await appendFile(LEDGER, JSON.stringify(entry) + "\n", "utf8");
}
