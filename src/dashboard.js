// Provider dashboard — "The Compute Meter". A self-contained instrument panel
// served at GET /. Polls /stats + /healthz once a second and renders live USDC
// metering: an amber LCD readout that flares on each settlement, fare-rate gauges,
// and a receipt-tape ledger of paid pulls. This is the screen for the demo.

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Joule · meter</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
  :root{
    --bg:#0A0F0E; --panel:#0E1413; --raised:#121A18; --window:#080C0B;
    --rule:#1E2A27; --ink:#E8F0EC; --dim:#7C918A;
    --meter:#FF9F1C; --meter-soft:rgba(255,159,28,.16); --meter-ghost:rgba(255,159,28,.07);
    --live:#3FE0A8; --stop:#FF5C49;
    --mono:'IBM Plex Mono',ui-monospace,'Cascadia Code',Consolas,monospace;
    --disp:'Space Grotesk',system-ui,-apple-system,Segoe UI,sans-serif;
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{
    background:
      radial-gradient(120% 80% at 50% -10%, #10201c 0%, var(--bg) 55%);
    color:var(--ink); font-family:var(--disp);
    -webkit-font-smoothing:antialiased; min-height:100vh;
  }
  .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .wrap{max-width:1080px;margin:0 auto;padding:22px 24px 40px}

  /* ---- top rail ---- */
  .rail{display:flex;align-items:center;justify-content:space-between;gap:16px;
    padding-bottom:18px;border-bottom:1px solid var(--rule)}
  .brand{display:flex;align-items:center;gap:14px}
  .mark{font-family:var(--mono);font-weight:600;letter-spacing:.32em;font-size:13px;color:var(--ink)}
  .unit{font-family:var(--mono);font-size:11px;letter-spacing:.22em;color:var(--dim);
    border:1px solid var(--rule);border-radius:2px;padding:4px 8px}
  .status{display:flex;align-items:center;gap:18px;font-family:var(--mono);font-size:11px;
    letter-spacing:.18em;color:var(--dim)}
  .status b{color:var(--ink);font-weight:500}
  .lamp{display:inline-flex;align-items:center;gap:8px}
  .lamp .dot{width:9px;height:9px;border-radius:50%;background:#33403c;
    box-shadow:0 0 0 0 rgba(63,224,168,0);transition:background .2s}
  .lamp.live .dot{background:var(--live)}
  .lamp.idle .dot{background:var(--stop)}
  .lamp.beat .dot{animation:beat 1.1s ease-out}
  @keyframes beat{0%{box-shadow:0 0 0 0 rgba(63,224,168,.55)}100%{box-shadow:0 0 0 14px rgba(63,224,168,0)}}

  /* ---- hero meter ---- */
  .meter-card{margin-top:26px;background:linear-gradient(180deg,var(--panel),#0b110f);
    border:1px solid var(--rule);border-radius:14px;overflow:hidden}
  .meter-head{display:flex;justify-content:space-between;align-items:center;
    padding:14px 22px;border-bottom:1px solid var(--rule)}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.34em;color:var(--dim);text-transform:uppercase}
  .meter-body{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;
    padding:30px 22px 26px}
  .window{position:relative;background:var(--window);border:1px solid #16201d;
    border-radius:10px;padding:22px 26px;box-shadow:inset 0 2px 18px rgba(0,0,0,.6)}
  .window::after{content:"";position:absolute;inset:0;border-radius:10px;pointer-events:none;
    background:repeating-linear-gradient(0deg,rgba(0,0,0,.16) 0 2px,transparent 2px 4px);opacity:.5}
  .readout{font-family:var(--mono);font-weight:600;color:var(--meter);
    font-size:clamp(40px,8vw,84px);line-height:1;letter-spacing:.02em;
    font-variant-numeric:tabular-nums;text-shadow:0 0 22px var(--meter-soft);position:relative;z-index:1}
  .readout .frac{font-size:.5em;opacity:.85}
  .readout .cur{font-size:.34em;letter-spacing:.2em;color:var(--dim);margin-left:.5em;vertical-align:.55em;text-shadow:none}
  .readout.flare{animation:flare .6s ease-out}
  @keyframes flare{0%{text-shadow:0 0 34px var(--meter)}100%{text-shadow:0 0 22px var(--meter-soft)}}
  .scan{height:3px;margin-top:14px;border-radius:2px;background:var(--meter-ghost);overflow:hidden;position:relative;z-index:1}
  .scan i{position:absolute;top:0;bottom:0;width:34%;background:linear-gradient(90deg,transparent,var(--meter),transparent);
    transform:translateX(-120%);opacity:0}
  .metering .scan i{animation:sweep 2.4s linear infinite;opacity:.8}
  @keyframes sweep{to{transform:translateX(320%)}}

  .fare{border-left:1px solid var(--rule);padding-left:22px;margin-left:22px;min-width:150px}
  .fare .k{font-family:var(--mono);font-size:11px;letter-spacing:.24em;color:var(--dim)}
  .fare .v{font-family:var(--mono);font-weight:500;color:var(--ink);font-size:22px;margin-top:4px}
  .fare .v small{color:var(--dim);font-size:12px;letter-spacing:.1em}
  .fare .row + .row{margin-top:16px}

  /* ---- gauges ---- */
  .gauges{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:14px}
  .gauge{background:var(--raised);border:1px solid var(--rule);border-radius:11px;padding:16px 18px}
  .gauge .k{font-family:var(--mono);font-size:11px;letter-spacing:.2em;color:var(--dim);text-transform:uppercase}
  .gauge .v{font-family:var(--mono);font-weight:500;font-size:26px;color:var(--ink);margin-top:10px;font-variant-numeric:tabular-nums}
  .gauge .s{font-family:var(--mono);font-size:11px;color:var(--dim);margin-top:4px;letter-spacing:.06em}

  /* ---- receipt tape ---- */
  .tape{margin-top:24px;background:var(--raised);border:1px solid var(--rule);border-radius:12px;overflow:hidden}
  .tape h2{margin:0;font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:var(--dim);
    text-transform:uppercase;padding:14px 18px;border-bottom:1px dashed var(--rule)}
  .row{display:grid;grid-template-columns:90px 1fr 56px 110px 1fr;gap:10px;align-items:center;
    padding:10px 18px;border-bottom:1px dashed var(--rule);font-family:var(--mono);font-size:12.5px;color:var(--dim)}
  .row:last-child{border-bottom:0}
  .row .amt{color:var(--meter);text-align:right}
  .row .id{color:var(--dim);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .who{color:var(--ink)}
  .row.fresh{animation:print .9s ease-out}
  @keyframes print{0%{background:rgba(63,224,168,.10)}100%{background:transparent}}
  .empty{padding:22px 18px;font-family:var(--mono);font-size:12px;color:var(--dim);letter-spacing:.06em}

  footer{margin-top:22px;font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--dim);
    display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  footer a{color:var(--dim);text-decoration:none;border-bottom:1px solid var(--rule)}
  footer a:hover,footer a:focus-visible{color:var(--meter);outline:none}

  @media(max-width:720px){
    .meter-body{grid-template-columns:1fr}
    .fare{border-left:0;border-top:1px solid var(--rule);padding:18px 0 0;margin:18px 0 0;display:flex;gap:30px}
    .fare .row + .row{margin-top:0}
    .gauges{grid-template-columns:repeat(2,1fr)}
    .row{grid-template-columns:72px 1fr 70px;}
    .row .id,.row .amt:nth-child(4){display:none}
  }
  @media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
</head>
<body>
<h2 class="sr-only">Live provider meter showing USDC earned per second, fare rate, and a ledger of settled payments.</h2>
<div class="wrap">
  <div class="rail">
    <div class="brand">
      <span class="mark">JOULE</span>
      <span class="unit">METER UNIT 01</span>
    </div>
    <div class="status">
      <span class="lamp" id="lamp"><span class="dot"></span><b id="state">STANDBY</b></span>
      <span>ARC TESTNET</span>
      <span>MODEL <b id="model">—</b></span>
    </div>
  </div>

  <div class="meter-card" id="mcard">
    <div class="meter-head">
      <span class="eyebrow">USDC metered</span>
      <span class="eyebrow" id="idle">idle —</span>
    </div>
    <div class="meter-body">
      <div class="window">
        <div class="readout" id="readout">0<span class="frac">.000000</span><span class="cur">USDC</span></div>
        <div class="scan"><i></i></div>
      </div>
      <div class="fare">
        <div class="row"><div class="k">FARE RATE</div><div class="v" id="rate">—<small> /sec</small></div></div>
        <div class="row"><div class="k">TICK</div><div class="v" id="tick">—<small> s</small></div></div>
      </div>
    </div>
  </div>

  <div class="gauges">
    <div class="gauge"><div class="k">Seconds sold</div><div class="v" id="secs">0</div><div class="s">metered</div></div>
    <div class="gauge"><div class="k">Streaming now</div><div class="v" id="active">0</div><div class="s">live sessions</div></div>
    <div class="gauge"><div class="k">Paid pulls</div><div class="v" id="jobs">0</div><div class="s">settlements</div></div>
    <div class="gauge"><div class="k">Engine</div><div class="v" id="engine" style="font-size:15px;letter-spacing:.04em">—</div><div class="s" id="host">—</div></div>
  </div>

  <div class="tape">
    <h2>Settlement tape</h2>
    <div id="rows"><div class="empty">awaiting first payment — start a buyer to print the tape</div></div>
  </div>

  <footer>
    <span>metered per second · settled via Circle x402 batching</span>
    <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer">view on Arcscan ↗</a>
  </footer>
</div>

<script>
  var $=function(id){return document.getElementById(id)};
  var prevJobs=-1;
  var short=function(s){return (s&&s.length>12)?s.slice(0,6)+"…"+s.slice(-4):(s||"—")};
  function money(n){
    var x=Number(n||0), i=Math.floor(x), f=x.toFixed(6).split(".")[1];
    return {i:i.toLocaleString("en-US"), f:f};
  }
  function paint(stats,health){
    var lamp=$("lamp"), active=stats.activeSessions||0;
    lamp.className="lamp "+(active>0?"live":(health.ok?"idle":""));
    $("state").textContent=active>0?"EARNING":(health.ok?"IDLE":"OFFLINE");
    $("mcard").classList.toggle("metering",active>0);
    $("model").textContent=health.model||"—";
    $("idle").textContent="idle "+(health.idleSeconds==null?"—":health.idleSeconds+"s");

    var m=money(stats.earnings.totalUsdc);
    $("readout").innerHTML=m.i+'<span class="frac">.'+m.f+'</span><span class="cur">USDC</span>';
    $("rate").innerHTML=(stats.pricing.usdcPerSecond)+'<small> /sec</small>';
    $("tick").innerHTML=(stats.pricing.tickSeconds)+'<small> s</small>';
    $("secs").textContent=stats.earnings.totalSeconds||0;
    $("active").textContent=active;
    $("jobs").textContent=stats.earnings.jobs||0;
    var g=stats.system&&stats.system.gpu;
    $("engine").textContent=(g&&g.present)?(g.vendor+" GPU"):"CPU";
    $("host").textContent=(stats.system&&stats.system.hostname)||"—";

    var jobs=stats.earnings.jobs||0;
    if(prevJobs>=0 && jobs>prevJobs){
      var r=$("readout"); r.classList.remove("flare"); void r.offsetWidth; r.classList.add("flare");
      lamp.classList.add("beat"); setTimeout(function(){lamp.classList.remove("beat")},1100);
    }
    var fresh=(prevJobs>=0 && jobs>prevJobs);
    prevJobs=jobs;

    var list=stats.earnings.lastJobs||[];
    if(!list.length){return}
    $("rows").innerHTML=list.map(function(j,idx){
      var t=new Date(j.ts).toLocaleTimeString("en-GB");
      var cls="row"+((fresh&&idx===0)?" fresh":"");
      return '<div class="'+cls+'">'+
        '<span>'+t+'</span>'+
        '<span class="who">'+short(j.payer)+'</span>'+
        '<span>'+(j.seconds||0)+'s</span>'+
        '<span class="amt">+'+Number(j.amountUsdc||0).toFixed(6)+'</span>'+
        '<span class="id">batch '+short(j.gatewayTx)+'</span>'+
      '</div>';
    }).join("");
  }
  async function tick(){
    try{
      var s=await fetch("/stats").then(function(r){return r.json()});
      var h=await fetch("/healthz").then(function(r){return r.json()}).catch(function(){return {}});
      paint(s,h);
    }catch(e){
      $("state").textContent="OFFLINE"; $("lamp").className="lamp";
    }
  }
  tick(); setInterval(tick,1000);
</script>
</body>
</html>`;
