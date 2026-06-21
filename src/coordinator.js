// Joule coordinator — the network layer. Providers connect OUTBOUND (register +
// heartbeat over HTTP, so no port-forwarding is needed to be *listed*), and buyer
// agents discover live nodes here instead of hardcoding one URL. Dependency-free.
//
//   npm run coordinator        (default :19150)
//
// Endpoints:
//   POST /register   provider announces { id, name, url, model, pricePerSecond, sellerAddress }
//   POST /heartbeat  provider pings { id, activeSessions, secondsSold, earnedUsdc, pricePerSecond }
//   GET  /nodes      live nodes (seen in the last 40s) — what buyer agents query
//   GET  /           network dashboard

import http from "node:http";

const PORT = Number(process.env.COORDINATOR_PORT || 19150);
const TTL_MS = 40000;
const nodes = new Map(); // id -> node record

function send(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(obj));
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return null;
  }
}
const live = () => [...nodes.values()].filter((n) => Date.now() - n.lastSeen < TTL_MS);

// --- lite-node job queue ---------------------------------------------------
// Browser-extension ("lite") nodes can't accept inbound connections, so instead
// of buyers connecting to them, buyers POST a job here and lite nodes PULL it:
//   POST /jobs          buyer submits { prompt, maxTokens } -> { id }
//   GET  /jobs/claim    a lite node claims the oldest pending job
//   POST /jobs/result   the lite node returns { id, worker, output, seconds }
//   GET  /jobs/:id      buyer polls for the result
const jobs = new Map(); // id -> job record
let jobSeq = 0;

setInterval(() => {
  for (const [id, n] of nodes) if (Date.now() - n.lastSeen > TTL_MS * 2) nodes.delete(id);
}, 10000).unref?.();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === "POST" && p === "/register") {
    const b = await readJson(req);
    if (!b?.id) return send(res, 400, { error: "id required" });
    const prev = nodes.get(b.id) || {};
    nodes.set(b.id, {
      id: b.id,
      name: b.name || "node",
      url: b.url || null,
      model: b.model || "?",
      pricePerSecond: b.pricePerSecond ?? null,
      sellerAddress: b.sellerAddress || null,
      region: b.region || null,
      secondsSold: prev.secondsSold || 0,
      earnedUsdc: prev.earnedUsdc || 0,
      activeSessions: 0,
      joinedAt: prev.joinedAt || Date.now(),
      lastSeen: Date.now(),
    });
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && p === "/heartbeat") {
    const b = await readJson(req);
    const n = b?.id && nodes.get(b.id);
    if (!n) return send(res, 404, { error: "unregistered" });
    n.lastSeen = Date.now();
    if (b.activeSessions != null) n.activeSessions = b.activeSessions;
    if (b.secondsSold != null) n.secondsSold = b.secondsSold;
    if (b.earnedUsdc != null) n.earnedUsdc = b.earnedUsdc;
    if (b.pricePerSecond != null) n.pricePerSecond = b.pricePerSecond;
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && p === "/nodes") {
    return send(res, 200, { nodes: live(), count: live().length });
  }

  if (req.method === "POST" && p === "/jobs") {
    const b = await readJson(req);
    if (!b?.prompt) return send(res, 400, { error: "prompt required" });
    const id = "j" + ++jobSeq;
    jobs.set(id, {
      id,
      prompt: String(b.prompt).slice(0, 2000),
      maxTokens: Math.min(Number(b.maxTokens) || 128, 512),
      status: "pending",
      output: "",
      worker: null,
      workerName: null,
      seconds: 0,
      createdAt: Date.now(),
    });
    return send(res, 200, { id });
  }

  if (req.method === "GET" && p === "/jobs/claim") {
    const worker = url.searchParams.get("worker");
    let job = null;
    for (const j of jobs.values()) if (j.status === "pending") { job = j; break; }
    if (!job) return send(res, 200, { none: true });
    job.status = "claimed";
    job.worker = worker || null;
    job.claimedAt = Date.now();
    return send(res, 200, { id: job.id, prompt: job.prompt, maxTokens: job.maxTokens });
  }

  if (req.method === "POST" && p === "/jobs/result") {
    const b = await readJson(req);
    const job = b?.id && jobs.get(b.id);
    if (!job) return send(res, 404, { error: "unknown job" });
    job.status = "done";
    job.output = String(b.output || "");
    job.seconds = Number(b.seconds) || 0;
    job.doneAt = Date.now();
    const n = b.worker && nodes.get(b.worker);
    if (n) {
      job.workerName = n.name;
      n.secondsSold += job.seconds;
      n.earnedUsdc += job.seconds * (n.pricePerSecond || 0);
    }
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && p.startsWith("/jobs/")) {
    const job = jobs.get(p.slice("/jobs/".length));
    if (!job) return send(res, 404, { error: "unknown job" });
    return send(res, 200, { id: job.id, status: job.status, output: job.output, seconds: job.seconds, workerName: job.workerName });
  }

  if (req.method === "GET" && p === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(NETWORK_HTML);
  }

  send(res, 404, { error: "not_found" });
});

server.listen(PORT, () => console.log(`Joule coordinator on http://localhost:${PORT}  (providers register here; buyers discover via /nodes)`));

const NETWORK_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Joule · network</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet"/>
<style>
  :root{--bg:#0A0F0E;--raised:#121A18;--rule:#1E2A27;--ink:#E8F0EC;--dim:#7C918A;--meter:#FF9F1C;--meter-soft:rgba(255,159,28,.16);--live:#3FE0A8;--stop:#FF5C49;--mono:'IBM Plex Mono',ui-monospace,Consolas,monospace;--disp:'Space Grotesk',system-ui,sans-serif}
  *{box-sizing:border-box}html,body{margin:0}
  body{background:radial-gradient(120% 80% at 50% -10%,#15110a 0%,var(--bg) 55%);color:var(--ink);font-family:var(--disp);-webkit-font-smoothing:antialiased;min-height:100vh}
  .wrap{max-width:1000px;margin:0 auto;padding:24px 24px 48px}
  .rail{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--rule);padding-bottom:16px}
  .mark{font-family:var(--mono);font-weight:600;letter-spacing:.3em;font-size:13px}
  .net{font-family:var(--mono);font-size:11px;letter-spacing:.18em;color:var(--dim)}
  h1{font-size:clamp(26px,4vw,40px);letter-spacing:-.02em;margin:26px 0 0;font-weight:700}
  h1 .g{color:var(--meter)} .lead{font-family:var(--mono);color:var(--dim);font-size:13px;margin:12px 0 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-top:24px}
  .node{background:var(--raised);border:1px solid var(--rule);border-radius:13px;padding:18px}
  .node .top{display:flex;align-items:center;justify-content:space-between}
  .node .nm{font-family:var(--mono);font-weight:600;font-size:14px;color:var(--ink)}
  .node .dot{width:8px;height:8px;border-radius:50%;background:var(--live);box-shadow:0 0 8px var(--live)}
  .node .dot.busy{background:var(--meter);box-shadow:0 0 8px var(--meter)}
  .node .model{font-family:var(--mono);font-size:11px;color:var(--dim);margin-top:8px;letter-spacing:.04em}
  .node .price{font-family:var(--mono);font-weight:600;color:var(--meter);font-size:22px;margin-top:14px;font-variant-numeric:tabular-nums}
  .node .price small{font-size:.5em;color:var(--dim);letter-spacing:.1em}
  .node .stats{display:flex;gap:16px;margin-top:12px;font-family:var(--mono);font-size:11px;color:var(--dim)}
  .node .stats b{color:var(--ink);font-weight:500}
  .node .addr{font-family:var(--mono);font-size:10px;color:var(--dim);margin-top:10px;letter-spacing:.04em}
  .empty{font-family:var(--mono);color:var(--dim);font-size:13px;margin-top:30px;border:1px dashed var(--rule);border-radius:12px;padding:26px;text-align:center}
  .band{display:flex;gap:26px;margin-top:18px;font-family:var(--mono);font-size:12px;color:var(--dim)}
  .band b{color:var(--ink)}
  @keyframes p{0%,100%{opacity:1}50%{opacity:.4}} .dot{animation:p 1.4s ease-in-out infinite}
</style></head><body>
<div class="wrap">
  <div class="rail"><span class="mark">JOULE · NETWORK</span><span class="net" id="net">connecting…</span></div>
  <h1><span class="g" id="count">0</span> nodes selling idle compute</h1>
  <p class="lead">Live providers that registered with this coordinator. Buyer agents discover them here and pay the best one per second.</p>
  <div class="band"><span>total seconds sold <b id="tsec">0</b></span><span>total earned <b id="tusd">0</b> USDC</span><span>serving now <b id="tact">0</b></span></div>
  <div class="grid" id="grid"></div>
  <div class="empty" id="empty" hidden>No nodes yet. Start one with <span style="color:var(--ink)">COORDINATOR_URL=http://localhost:${PORT} npm start</span>.</div>
</div>
<script>
  var $=function(id){return document.getElementById(id)};
  var short=function(s){return s&&s.length>12?s.slice(0,6)+"…"+s.slice(-4):(s||"—")};
  async function tick(){
    try{
      var d=await fetch("/nodes").then(function(r){return r.json()});
      $("net").textContent="LIVE · "+d.count+" node(s)";
      $("count").textContent=d.count;
      var tsec=0,tusd=0,tact=0;
      $("grid").innerHTML=d.nodes.map(function(n){
        tsec+=n.secondsSold||0; tusd+=Number(n.earnedUsdc||0); tact+=n.activeSessions||0;
        return '<div class="node"><div class="top"><span class="nm">'+n.name+'</span><span class="dot'+(n.activeSessions>0?' busy':'')+'"></span></div>'+
          '<div class="model">'+n.model+'</div>'+
          '<div class="price">'+(n.pricePerSecond!=null?n.pricePerSecond:'—')+'<small> USDC/sec</small></div>'+
          '<div class="stats"><span><b>'+(n.secondsSold||0)+'</b> sec sold</span><span><b>'+Number(n.earnedUsdc||0).toFixed(4)+'</b> USDC</span><span><b>'+(n.activeSessions||0)+'</b> live</span></div>'+
          '<div class="addr">payout '+short(n.sellerAddress)+'</div></div>';
      }).join("");
      $("tsec").textContent=tsec; $("tusd").textContent=tusd.toFixed(4); $("tact").textContent=tact;
      $("empty").hidden=d.count>0;
    }catch(e){ $("net").textContent="coordinator unreachable"; }
  }
  tick(); setInterval(tick,3000);
</script></body></html>`;
