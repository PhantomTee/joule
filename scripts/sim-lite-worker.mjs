// One-shot test stub: claims the next pending job from the coordinator, "runs"
// it, and posts a result — standing in for the browser extension during a
// scripted end-to-end test of the real x402 settlement path. Not used in prod.
const B = process.argv[2] || "http://localhost:19150";
const WORKER = process.argv[3] || "lite-test1";
for (let i = 0; i < 30; i++) {
  const job = await fetch(`${B}/jobs/claim?worker=${WORKER}`).then((r) => r.json());
  if (!job.none) {
    console.log("claimed", job.id, job.prompt);
    await fetch(`${B}/jobs/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: job.id, worker: WORKER, output: `Hello! (answered: "${job.prompt}")`, seconds: 2 }),
    });
    console.log("delivered result for", job.id);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 500));
}
console.log("no job appeared");
