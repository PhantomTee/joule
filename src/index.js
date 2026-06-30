// Provider entrypoint: keep a model warm, watch idle state, and serve the
// x402-gated pay-per-second inference sidecar.

import { config } from "./config.js";
import { createServer } from "./server.js";
import { IdleMonitor } from "./idle.js";
import * as inference from "./inference.js";
import { startCoordinatorClient } from "./coordinator-client.js";
import { logger } from "./logger.js";

async function main() {
  logger.info("Joule provider starting", {
    model:    config.model,
    inference: config.inferenceBase,
    pricing:  `${config.pricePerSecondUsdc} USDC/sec (tick ${config.tickSeconds}s)`,
    seller:   config.sellerAddress || "(SELLER_ADDRESS unset — settlement will fail)",
    network:  config.arc.network,
  });

  const up = await inference.health();
  if (!up) {
    logger.warn("inference backend not reachable — start the llamafile or set INFERENCE_BASE", {
      base: config.inferenceBase,
    });
  } else {
    logger.info("warming model…");
    await inference.keepWarm();
  }

  const idleMonitor = new IdleMonitor().start();
  const { server } = createServer({ idleMonitor });

  server.listen(config.port, () => {
    logger.info("provider listening", {
      url:     `http://localhost:${config.port}`,
      metrics: `http://localhost:${config.port}/metrics`,
      docs:    `http://localhost:${config.port}/`,
    });
  });

  const coordinator = startCoordinatorClient();

  const shutdown = () => {
    logger.info("shutting down");
    idleMonitor.stop();
    coordinator?.stop?.();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.fatal("startup failed", { err: err.message, stack: err.stack });
  process.exit(1);
});
