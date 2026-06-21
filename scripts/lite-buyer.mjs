// Submit an inference job to the coordinator queue and wait for a lite (browser)
// node to answer it. Demonstrates the pull-based path the extension uses.
//
//   npm run lite:ask -- "Explain x402 in one line"

const C = (process.env.COORDINATOR_URL || "http://localhost:19150").replace(/\/$/, "");
const prompt = process.argv.slice(2).join(" ") || "Explain x402 in one line.";

const { id } = await fetch(`${C}/jobs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt, maxTokens: 128 }),
}).then((r) => r.json());

process.stdout.write(`job ${id} submitted — waiting for a lite node…`);
for (;;) {
  await new Promise((r) => setTimeout(r, 1000));
  const j = await fetch(`${C}/jobs/${id}`).then((r) => r.json());
  if (j.status === "done") {
    console.log(`\n\n[${j.workerName || "worker"} · ${j.seconds}s]\n${j.output}\n`);
    break;
  }
  process.stdout.write(".");
}
process.exit(0);
