#!/usr/bin/env node
// npm run market-snapshot [-- --url <coord>]
// Fetches the live provider list and prints a ranked table to stdout.

const coord = (() => {
  const i = process.argv.indexOf("--url");
  return i !== -1 ? process.argv[i + 1] : (process.env.COORDINATOR_URL || "https://joule-coordinator.onrender.com");
})();

async function main() {
  process.stdout.write(`Fetching providers from ${coord}/nodes …\n`);
  let nodes;
  try {
    const d = await fetch(`${coord}/nodes`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json());
    nodes = d.nodes || [];
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }

  if (nodes.length === 0) {
    process.stdout.write("No providers online.\n");
    return;
  }

  // Sort by earnings descending
  nodes.sort((a, b) => Number(b.earnedUsdc || 0) - Number(a.earnedUsdc || 0));

  const totalEarned = nodes.reduce((s, n) => s + Number(n.earnedUsdc || 0), 0);
  const totalSecs   = nodes.reduce((s, n) => s + Number(n.secondsSold || 0), 0);
  const liveSessions = nodes.reduce((s, n) => s + (n.activeSessions || 0), 0);

  const hr = "─".repeat(100);
  const fmt = (v, w) => String(v).slice(0, w).padEnd(w);
  const fmtr = (v, w) => String(v).slice(0, w).padStart(w);

  process.stdout.write(`\n${hr}\n`);
  process.stdout.write(` JOULE MARKET SNAPSHOT  ${new Date().toISOString()}\n`);
  process.stdout.write(` ${nodes.length} providers · ${totalSecs.toLocaleString()} seconds sold · ${totalEarned.toFixed(6)} USDC total · ${liveSessions} live sessions\n`);
  process.stdout.write(`${hr}\n`);
  process.stdout.write(
    ` ${fmt("RANK", 4)} ${fmt("NAME", 24)} ${fmt("MODEL", 20)} ${fmtr("PRICE/SEC", 12)} ${fmtr("EARNED USDC", 14)} ${fmtr("SECS SOLD", 12)} ${fmtr("LIVE", 4)} ${fmt("KIND", 6)}\n`,
  );
  process.stdout.write(`${hr}\n`);

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const live = n.activeSessions || 0;
    const liveStr = live > 0 ? `●${live}` : "○";
    process.stdout.write(
      ` ${fmtr(i + 1, 4)} ${fmt(n.name || n.id || "?", 24)} ${fmt(n.model || "—", 20)} ${fmtr((n.pricePerSecond ?? "—").toString(), 12)} ${fmtr(Number(n.earnedUsdc || 0).toFixed(6), 14)} ${fmtr(Number(n.secondsSold || 0).toLocaleString(), 12)} ${fmtr(liveStr, 4)} ${fmt(n.kind || "native", 6)}\n`,
    );
    if (n.priceReason) {
      process.stdout.write(`       ${" ".repeat(24)} ${n.priceReason}\n`);
    }
  }

  process.stdout.write(`${hr}\n\n`);
}

main();
