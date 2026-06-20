// Loads a .env sitting next to the executable (or the cwd) into process.env.
// Imported FIRST by node-app.js so config.js sees the values when it evaluates.
// The packaged .exe has no bundler-time env, so this is how an operator configures
// their node (SELLER_ADDRESS, etc.) by dropping a .env beside the exe.
import fs from "node:fs";
import path from "node:path";

for (const dir of [path.dirname(process.execPath), process.cwd()]) {
  const file = path.join(dir, ".env");
  try {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].trim();
      }
    }
  } catch {
    /* ignore */
  }
}
