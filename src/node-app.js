// Packaged DePIN node launcher (the entry baked into the .exe). It:
//   1. loads .env next to the exe,
//   2. starts the local Qwen model if present (downloads instructions if not),
//   3. starts the x402 provider + dashboards.
// Run the built exe and your idle machine becomes a paid inference provider.
import "./load-env.js";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { createServer } from "./server.js";
import { IdleMonitor } from "./idle.js";
import * as inference from "./inference.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const baseDir = path.dirname(process.execPath);
const MODEL_URL =
  "https://huggingface.co/mozilla-ai/Qwen2.5-0.5B-Instruct-llamafile/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.llamafile?download=true";

function findModel() {
  const candidates = [
    path.join(baseDir, "models", "qwen.exe"),
    path.join(baseDir, "qwen.exe"),
    process.env.MODEL_EXE || "",
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

async function ensureModel() {
  if (await inference.health()) {
    console.log(`  inference backend already up at ${config.inferenceBase}`);
    return;
  }
  const model = findModel();
  if (!model) {
    console.log("\n  ⚠ No local model found. Download it once (~673 MB) and place it next to this exe as models\\qwen.exe:");
    console.log(`     ${MODEL_URL}`);
    console.log("  (or set INFERENCE_BASE to any OpenAI-compatible endpoint in your .env)\n");
    return;
  }
  console.log(`  starting local model: ${model}`);
  const child = spawn(model, ["--server", "--nobrowser", "--host", "127.0.0.1", "--port", "8080", "-ngl", "0"], {
    stdio: "ignore",
  });
  child.on("error", (e) => console.error("  model spawn error:", e.message));
  for (let i = 0; i < 90; i++) {
    if (await inference.health()) {
      console.log("  model ready");
      return;
    }
    await sleep(2000);
  }
  console.warn("  model did not become ready in time — provider will start anyway");
}

async function main() {
  console.log("Joule node starting…");
  console.log(`  seller:   ${config.sellerAddress || "(set SELLER_ADDRESS in .env to receive earnings)"}`);
  console.log(`  pricing:  ${config.pricePerSecondUsdc} USDC/sec on Arc testnet`);
  await ensureModel();
  if (await inference.health()) await inference.keepWarm();

  const idleMonitor = new IdleMonitor().start();
  const { server } = createServer({ idleMonitor });
  server.listen(config.port, () => {
    console.log(`\n  node online → http://localhost:${config.port}`);
    console.log(`  operator console → http://localhost:${config.port}/node`);
    console.log("  press Ctrl+C to stop earning.\n");
  });

  const shutdown = () => {
    idleMonitor.stop();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
