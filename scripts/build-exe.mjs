// Builds a standalone DePIN node executable (no Node/npm needed to run it):
//   1. esbuild bundles src/node-app.js + all deps (Circle SDK, viem) into one CJS,
//   2. Node SEA packs it into a blob,
//   3. postject injects the blob into a copy of the Node runtime.
// The ~673 MB model is NOT bundled — the node fetches/launches it on first run,
// so the exe stays app-sized (~80 MB).
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { mkdirSync, copyFileSync, writeFileSync, statSync } from "node:fs";

mkdirSync("build", { recursive: true });
mkdirSync("dist", { recursive: true });

console.log("1/3 bundling…");
await build({
  entryPoints: ["src/node-app.js"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: "build/idle-node.cjs",
});

console.log("2/3 packing SEA blob…");
writeFileSync(
  "build/sea-config.json",
  JSON.stringify({ main: "build/idle-node.cjs", output: "build/sea-prep.blob", disableExperimentalSEAWarning: true }, null, 2),
);
execSync("node --experimental-sea-config build/sea-config.json", { stdio: "inherit" });

console.log("3/3 injecting into runtime…");
const isWin = process.platform === "win32";
const out = isWin ? "dist/joule-node.exe" : "dist/joule-node";
copyFileSync(process.execPath, out);
const fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const extra = process.platform === "darwin" ? "--macho-segment-name NODE_SEA" : "";
execSync(`node node_modules/postject/dist/cli.js ${out} NODE_SEA_BLOB build/sea-prep.blob --sentinel-fuse ${fuse} ${extra}`, {
  stdio: "inherit",
});

console.log(`\n✓ built ${out}  (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
console.log("  Drop a .env (SELLER_ADDRESS=…) next to it and double-click to run a node.");
