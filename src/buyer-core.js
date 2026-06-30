// Shared buyer loop, used by both the CLI (buyer.js) and the web console
// (buyer-server.js). Opens a paid session and pays one x402 tick per pull,
// streaming tokens and running spend back through callbacks. Stops cleanly when
// shouldStop() returns true (tap-to-stop) — the provider then frees the model.

import { appendFile, mkdir } from "node:fs/promises";
import { config } from "./config.js";
import { verifyAttestation, parseAttestationHeader } from "./attestation.js";

// Append-only log of every attestation result (verified or not)
const VERIF_LOG = "./data/verifications.jsonl";
async function logVerification(entry) {
  await mkdir("./data", { recursive: true }).catch(() => {});
  await appendFile(VERIF_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8").catch(() => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bodyOf = (res) => res?.data ?? res?.body ?? res?.response ?? res;
const amountOf = (res) => Number(res?.formattedAmount ?? res?.amount ?? 0) || 0;

export async function makeGateway() {
  const key = process.env.BUYER_PRIVATE_KEY;
  if (!key) throw new Error("BUYER_PRIVATE_KEY not set");
  const { GatewayClient } = await import("@circle-fin/x402-batching/client");
  return new GatewayClient({ chain: config.chain, privateKey: key });
}

/**
 * Run one paid streaming session.
 * @param {object} p
 * @param {object} p.gateway   GatewayClient
 * @param {string} p.baseUrl   provider base (e.g. http://localhost:19131)
 * @param {string} p.prompt
 * @param {(text:string, spent:number)=>void} [p.onToken]
 * @param {(info:{spent:number, seconds:number})=>void} [p.onTick]
 * @param {(info:object)=>void} [p.onStatus]
 * @param {()=>boolean} [p.shouldStop]
 * @returns {Promise<{spent:number, seconds:number, stopped?:boolean, done?:boolean, error?:string}>}
 */
export async function runSession({ gateway, baseUrl, prompt, onToken, onTick, onStatus, shouldStop, providerAddress }) {
  let spent = 0;
  let seconds = 0;
  let fullOutput = "";

  // Discover provider address from agent card if not explicitly given (for attestation)
  if (!providerAddress) {
    try {
      const card = await fetch(`${baseUrl}/agent-card`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json());
      providerAddress = card?.provider?.wallet;
    } catch {}
  }

  onStatus?.({ phase: "opening", spent });
  const openRes = await gateway.pay(`${baseUrl}/v1/sessions`, {
    method: "POST",
    body: { messages: [{ role: "user", content: prompt }] },
  });
  const open = bodyOf(openRes);
  spent += amountOf(openRes);
  const sessionId = open.sessionId;
  seconds = open.state?.seconds ?? 0;

  onStatus?.({ phase: "streaming", sessionId, spent, seconds });
  if (open.tokens) { fullOutput += open.tokens; onToken?.(open.tokens, spent); }

  let done = !!open.done;
  while (!done) {
    if (await shouldStop?.()) {
      try {
        await fetch(`${baseUrl}/v1/sessions/${sessionId}/stop`, { method: "POST" });
      } catch {}
      onStatus?.({ phase: "stopped", spent, seconds });
      return { spent, seconds, stopped: true, sessionId };
    }

    let pullRes;
    try {
      pullRes = await gateway.pay(`${baseUrl}/v1/sessions/${sessionId}/pull`, { method: "POST" });
    } catch (err) {
      onStatus?.({ phase: "error", error: String(err?.message ?? err), spent, seconds });
      return { spent, seconds, error: String(err?.message ?? err) };
    }
    const pull = bodyOf(pullRes);
    spent += amountOf(pullRes);
    seconds = pull.state?.seconds ?? seconds + config.tickSeconds;
    if (pull.tokens) { fullOutput += pull.tokens; onToken?.(pull.tokens, spent); }
    onTick?.({ spent, seconds });
    done = !!pull.done;

    // On the final pull, verify the attestation header
    if (done && providerAddress) {
      const rawHeader = pullRes?.headers?.get?.("x-inference-attestation")
        ?? pullRes?.response?.headers?.get?.("x-inference-attestation");
      const attestation = parseAttestationHeader(rawHeader);
      const result = await verifyAttestation(attestation, prompt, fullOutput, providerAddress)
        .catch((err) => ({ ok: false, reason: err.message }));
      await logVerification({ sessionId, providerAddress, ...result, attestation: attestation ?? null });
      onStatus?.({ phase: "attestation", ...result });
    }

    if (!done) await sleep(config.tickSeconds * 1000);
  }

  onStatus?.({ phase: "done", spent, seconds });
  return { spent, seconds, done: true, sessionId, fullOutput };
}
