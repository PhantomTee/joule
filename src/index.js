// Provider entrypoint: keep a model warm, watch idle state, and serve the
// x402-gated pay-per-second inference sidecar.

import { config } from "./config.js";
import { createServer } from "./server.js";
import { IdleMonitor } from "./idle.js";
import * as inference from "./inference.js";

async function main() {
  console.log("Joule provider starting…");
  console.log(`  model:     ${config.model}`);
  console.log(`  inference: ${config.inferenceBase}`);
  console.log(`  pricing:   ${config.pricePerSecondUsdc} USDC/sec (tick ${config.tickSeconds}s)`);
  console.log(`  seller:    ${config.sellerAddress || "(SELLER_ADDRESS unset — settlement will fail)"}`);
  console.log(`  network:   ${config.arc.network} (Arc testnet)`);

  const up = await inference.health();
  if (!up) {
    console.warn(`  ⚠ Inference backend not reachable at ${config.inferenceBase} — start the Qwen llamafile (or set INFERENCE_BASE).`);
  } else {
    console.log("  warming model…");
    await inference.keepWarm();
  }

  const idleMonitor = new IdleMonitor().start();
  const { server } = createServer({ idleMonitor });

  server.listen(config.port, () => {
    console.log(`\nProvider listening on http://localhost:${config.port}`);
    console.log("  POST /v1/sessions            open a paid session");
    console.log("  POST /v1/sessions/:id/pull   pay one tick, collect tokens");
    console.log("  POST /v1/sessions/:id/stop   tap to stop");
    console.log("  GET  /stats                  earnings + system\n");
  });

  const shutdown = () => {
    console.log("\nshutting down…");
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
