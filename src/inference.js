// Inference client for any OpenAI-compatible server: a Qwen llamafile (default,
// :8080), Ollama (:11434), or a hosted API (Groq/OpenAI/Together) with a key.
// - health(): is the backend reachable?
// - keepWarm(): nudge the model so the first paid token isn't a cold start
// - streamChat(): stream tokens from POST /v1/chat/completions

import { config } from "./config.js";

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (config.inferenceApiKey) h["Authorization"] = `Bearer ${config.inferenceApiKey}`;
  return h;
}

export async function health(base = config.inferenceBase) {
  try {
    const res = await fetch(`${base}/v1/models`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Best-effort warm-up: a 1-token completion to load the model into memory.
export async function keepWarm(base = config.inferenceBase) {
  try {
    await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(60000),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stream an OpenAI-compatible chat completion.
 *
 * @param body  the buyer's chat-completions request (messages, ...)
 * @param onToken  called with each text delta as it streams
 * @param signal  AbortSignal — aborting it stops generation (tap-to-stop)
 * @returns {Promise<{outputTokens:number, finished:boolean, aborted?:boolean}>}
 */
export async function streamChat({ body, onToken, signal, base = config.inferenceBase }) {
  const req = {
    model: config.model,
    ...body,
    stream: true,
    stream_options: { include_usage: true, ...(body.stream_options ?? {}) },
  };

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`inference chat HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputTokens = 0;
  let finished = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank lines; each "data: {...}" is JSON.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          finished = true;
          continue;
        }
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          outputTokens += 1; // approx: one delta ≈ one token for metering
          // Awaiting lets the consumer apply backpressure: if it blocks (buffer
          // full, awaiting payment), we stop reading and the model pauses too.
          await onToken(delta);
        }
        if (parsed.usage?.completion_tokens) {
          outputTokens = parsed.usage.completion_tokens;
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") {
      return { outputTokens, finished: false, aborted: true };
    }
    throw err;
  }

  return { outputTokens, finished };
}
