// Server-side streaming sessions. Each session holds a live Ollama stream and a
// Meter. The model keeps generating into a buffer; the buyer pays per "pull" to
// collect the tokens produced since their last paid pull. If the buyer stops
// paying (tap-to-stop), the reaper aborts the stream so no compute is wasted.

import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { Meter } from "./metering.js";
import { streamChat } from "./inference.js";

const STATUS = {
  STREAMING: "streaming",
  DONE: "done", // model finished; remaining tokens still collectable
  STOPPED: "stopped", // tapped to stop / reaped
  ERROR: "error",
};

// How many tokens the model may generate ahead of the buyer's payments before it
// pauses (backpressure). Roughly one tick's worth, so generation paces to payment.
const BUFFER_CAP = Number(process.env.BUFFER_CAP_TOKENS || 48);

class Session {
  constructor({ model, body, payer, pricePerSecondUsdc }) {
    this.id = randomUUID();
    this.model = model;
    this.payer = payer;
    // Price is agreed once, at session open, and locked for the session's life.
    this.pricePerSecondUsdc = pricePerSecondUsdc;
    this.meter = new Meter(pricePerSecondUsdc ? { pricePerSecondUsdc } : undefined).start();
    this.buffer = [];
    this.status = STATUS.STREAMING;
    this.finishedGenerating = false;
    this.error = null;
    this.lastPullAt = Date.now();
    this.pendingQuoteAtomic = null; // frozen price for the in-flight pull
    this.abort = new AbortController();
    this._drainResolve = null; // resolves when a paid pull drains the buffer
    this.fullOutput = ""; // accumulated for attestation signing
    // Extract the first user message as the "prompt" for attestation
    const msgs = body?.messages ?? [];
    this._prompt = msgs.filter((m) => m.role === "user").map((m) => m.content).join("\n");

    // Kick off generation server-side; tokens accrue into the buffer as they stream.
    this._run(body);
  }

  async _run(body) {
    try {
      const { outputTokens, finished } = await streamChat({
        body,
        signal: this.abort.signal,
        onToken: async (delta) => {
          this.buffer.push(delta);
          // Don't let the model run more than ~one tick of tokens ahead of what the
          // buyer has paid for: pause until the next paid pull drains the buffer.
          if (this.buffer.length >= BUFFER_CAP && this.status === STATUS.STREAMING) {
            await new Promise((resolve) => {
              this._drainResolve = resolve;
            });
          }
        },
      });
      this.meter.addOutputTokens(outputTokens);
      if (this.status !== STATUS.STOPPED) {
        this.finishedGenerating = true;
        this.status = STATUS.DONE;
      }
    } catch (err) {
      if (err.name === "AbortError") return; // intentional stop
      this.status = STATUS.ERROR;
      this.error = err.message;
    }
  }

  // Tokens streamed since the last pull, cleared from the buffer. Draining frees
  // the backpressure gate so the model may generate the next interval.
  drainBuffer() {
    const text = this.buffer.join("");
    this.fullOutput += text; // accumulate for attestation
    this.buffer = [];
    this._releaseGate();
    return text;
  }

  _releaseGate() {
    if (this._drainResolve) {
      const r = this._drainResolve;
      this._drainResolve = null;
      r();
    }
  }

  stop(reason = "stopped") {
    if (this.status === STATUS.STOPPED) return;
    this.status = STATUS.STOPPED;
    this.stopReason = reason;
    this.meter.stop();
    this._releaseGate(); // unblock a paused generator so it can observe the abort
    this.abort.abort();
  }

  isComplete() {
    return this.finishedGenerating && this.buffer.length === 0;
  }

  publicState() {
    return {
      sessionId: this.id,
      status: this.status,
      finishedGenerating: this.finishedGenerating,
      pricePerSecondUsdc: this.pricePerSecondUsdc,
      ...this.meter.snapshot(),
    };
  }
}

export class SessionManager {
  constructor({ onSettlePull } = {}) {
    this.sessions = new Map();
    this.onSettlePull = onSettlePull;
    this.reaper = setInterval(() => this._reap(), 2000);
    this.reaper.unref?.();
  }

  create({ model, body, payer, pricePerSecondUsdc }) {
    const session = new Session({ model, body, payer, pricePerSecondUsdc });
    this.sessions.set(session.id, session);
    return session;
  }

  get(id) {
    return this.sessions.get(id);
  }

  touch(id) {
    const s = this.sessions.get(id);
    if (s) s.lastPullAt = Date.now();
  }

  remove(id) {
    this.sessions.delete(id);
  }

  // Tap-to-stop enforcement: abort sessions whose buyer stopped paying.
  _reap() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      const idleMs = now - s.lastPullAt;
      if (s.status === STATUS.STREAMING && idleMs > config.pullGraceSeconds * 1000) {
        s.stop("reaped_no_payment");
      }
      // Clean up terminal sessions whose buffer has been fully collected.
      if (
        (s.status === STATUS.STOPPED || s.status === STATUS.ERROR || s.isComplete()) &&
        idleMs > config.pullGraceSeconds * 2000
      ) {
        this.sessions.delete(id);
      }
    }
  }

  shutdown() {
    clearInterval(this.reaper);
    for (const s of this.sessions.values()) s.stop("shutdown");
  }
}

export { STATUS };
