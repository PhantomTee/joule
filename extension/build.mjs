// Bundle web-llm into vendor/web-llm.js so the offscreen page can import it
// (MV3 forbids loading remote scripts, so the engine must be local).
//
//   npm install        # installs @mlc-ai/web-llm + esbuild (devDeps)
//   npm run build      # writes vendor/web-llm.js
//
// Until you run this, the lite node runs in a clearly-labeled "stub" mode so the
// pull→run→result loop still works end-to-end.

import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("vendor", { recursive: true });

await build({
  stdin: { contents: 'export * from "@mlc-ai/web-llm";', resolveDir: ".", loader: "js" },
  bundle: true,
  format: "esm",
  outfile: "vendor/web-llm.js",
  platform: "browser",
  target: "es2020",
  legalComments: "none",
});

console.log("✓ built vendor/web-llm.js — reload the extension to enable real WebGPU inference");
