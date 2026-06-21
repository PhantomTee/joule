// Buyer console — the passenger's fare meter. You ask the network, the answer
// prints one paid second at a time, and the fare meter climbs. The one bold
// control is "Tap to stop": it guillotines the stream and locks the meter, so you
// see, physically, that you only pay for what you've read. Served at GET /.

export const BUYER_CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Joule · buyer</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
  :root{
    --bg:#0A0F0E; --panel:#0E1413; --raised:#121A18; --window:#080C0B;
    --rule:#1E2A27; --ink:#E8F0EC; --dim:#7C918A;
    --meter:#FF9F1C; --meter-soft:rgba(255,159,28,.16);
    --live:#3FE0A8; --stop:#FF5C49; --stop-soft:rgba(255,92,73,.14);
    --mono:'IBM Plex Mono',ui-monospace,Consolas,monospace;
    --disp:'Space Grotesk',system-ui,-apple-system,Segoe UI,sans-serif;
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{background:radial-gradient(120% 80% at 50% -10%,#10201c 0%,var(--bg) 55%);
    color:var(--ink);font-family:var(--disp);-webkit-font-smoothing:antialiased;min-height:100vh}
  .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .wrap{max-width:1080px;margin:0 auto;padding:22px 24px 40px}

  .rail{display:flex;align-items:center;justify-content:space-between;gap:16px;
    padding-bottom:18px;border-bottom:1px solid var(--rule)}
  .brand{display:flex;align-items:center;gap:14px}
  .mark{font-family:var(--mono);font-weight:600;letter-spacing:.32em;font-size:13px}
  .unit{font-family:var(--mono);font-size:11px;letter-spacing:.22em;color:var(--dim);
    border:1px solid var(--rule);border-radius:2px;padding:4px 8px}
  .status{display:flex;align-items:center;gap:18px;font-family:var(--mono);font-size:11px;letter-spacing:.18em;color:var(--dim)}
  .status b{color:var(--ink);font-weight:500}
  .lamp{display:inline-flex;align-items:center;gap:8px}
  .lamp .dot{width:9px;height:9px;border-radius:50%;background:#33403c}
  .lamp.on .dot{background:var(--live)}
  .lamp.off .dot{background:var(--stop)}

  /* ask bar */
  .ask{display:flex;gap:10px;margin-top:22px}
  .ask input{flex:1;background:var(--window);border:1px solid var(--rule);border-radius:10px;
    color:var(--ink);font-family:var(--mono);font-size:14px;padding:14px 16px;outline:none}
  .ask input::placeholder{color:var(--dim)}
  .ask input:focus-visible{border-color:var(--meter)}
  .btn{font-family:var(--mono);font-size:12px;letter-spacing:.12em;border-radius:10px;
    padding:0 20px;cursor:pointer;border:1px solid var(--rule);background:var(--raised);color:var(--ink);
    text-transform:uppercase;transition:transform .06s,border-color .2s,background .2s}
  .btn:hover{border-color:var(--meter)}
  .btn:active{transform:scale(.98)}
  .btn:disabled{opacity:.4;cursor:not-allowed}
  .btn:focus-visible{outline:2px solid var(--meter);outline-offset:2px}

  /* split */
  .grid{display:grid;grid-template-columns:1fr 280px;gap:14px;margin-top:14px}

  .stream{background:var(--window);border:1px solid var(--rule);border-radius:12px;
    min-height:340px;display:flex;flex-direction:column}
  .stream .hd{font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:var(--dim);
    text-transform:uppercase;padding:14px 18px;border-bottom:1px solid var(--rule)}
  .answer{padding:20px 22px;font-family:var(--mono);font-size:15px;line-height:1.75;color:var(--ink);
    white-space:pre-wrap;word-break:break-word;flex:1;overflow:auto}
  .answer .ph{color:var(--dim)}
  .caret{display:inline-block;width:9px;height:1.05em;background:var(--meter);vertical-align:-2px;
    margin-left:1px;animation:blink 1s steps(1) infinite}
  @keyframes blink{50%{opacity:0}}
  .cut{margin:14px 0 6px;border-top:1px dashed var(--stop);color:var(--stop);
    font-size:12px;letter-spacing:.1em;padding-top:8px}

  /* fare panel */
  .fare{background:var(--raised);border:1px solid var(--rule);border-radius:12px;
    padding:20px 20px 22px;display:flex;flex-direction:column}
  .fare .lbl{font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:var(--dim);text-transform:uppercase}
  .spend{font-family:var(--mono);font-weight:600;color:var(--meter);font-size:34px;line-height:1;
    margin-top:12px;font-variant-numeric:tabular-nums;text-shadow:0 0 18px var(--meter-soft)}
  .spend small{font-size:.4em;letter-spacing:.2em;color:var(--dim);margin-left:.4em;text-shadow:none}
  .spend.flash{animation:flash .5s ease-out}
  @keyframes flash{0%{text-shadow:0 0 30px var(--meter)}100%{text-shadow:0 0 18px var(--meter-soft)}}
  .secs{font-family:var(--mono);color:var(--dim);font-size:13px;margin-top:10px;letter-spacing:.08em}
  .secs b{color:var(--ink);font-weight:500}
  .stopbtn{margin-top:auto;font-family:var(--mono);letter-spacing:.18em;text-transform:uppercase;
    font-size:14px;font-weight:500;color:#1a0c0a;background:var(--stop);border:0;border-radius:10px;
    padding:16px;cursor:pointer;transition:transform .06s,filter .2s}
  .stopbtn:hover{filter:brightness(1.08)}
  .stopbtn:active{transform:scale(.98)}
  .stopbtn:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
  .stopbtn[hidden]{display:none}
  .rate{font-family:var(--mono);font-size:11px;color:var(--dim);letter-spacing:.06em;margin-top:14px;text-align:center}

  footer{margin-top:20px;font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--dim);
    display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}

  .think{margin-top:14px;background:var(--window);border:1px solid var(--rule);border-radius:12px;overflow:hidden}
  .think .hd{font-family:var(--mono);font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:var(--live);
    padding:11px 16px;border-bottom:1px solid var(--rule);display:flex;align-items:center;gap:9px}
  .think .hd .d{width:7px;height:7px;border-radius:50%;background:#33403c}
  .think .hd .d.on{background:var(--live);box-shadow:0 0 8px var(--live);animation:pulse 1.3s ease-in-out infinite}
  .think .log{padding:12px 16px;max-height:190px;overflow:auto;font-family:var(--mono);font-size:12.5px;line-height:1.7}
  .think .t{color:var(--ink);padding:3px 0;opacity:0;animation:tin .3s forwards}
  .think .t::before{content:"▸ ";color:var(--live)}
  .think .t.dim{color:var(--dim);opacity:.6}.think .t.dim::before{content:""}
  @keyframes tin{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  @media(max-width:720px){
    .grid{grid-template-columns:1fr}
    .ask{flex-wrap:wrap}
    .ask .btn{flex:1;padding:12px}
  }
  @media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
</head>
<body>
<h2 class="sr-only">Buyer console: ask the inference network, watch the answer stream while a fare meter counts the USDC spent per second, and tap stop to halt paying.</h2>
<div class="wrap">
  <div class="rail">
    <div class="brand"><span class="mark">JOULE</span><span class="unit">BUYER TERMINAL</span></div>
    <div class="status">
      <span class="lamp" id="lamp"><span class="dot"></span><b id="conn">CONNECTING</b></span>
      <span>BALANCE <b id="bal">—</b></span>
    </div>
  </div>

  <form class="ask" id="ask" autocomplete="off">
    <input id="prompt" placeholder="Ask the network anything" value="Explain Circle Arc in three sentences." />
    <button class="btn" id="start" type="submit">Start — pays per second</button>
  </form>

  <div class="think">
    <div class="hd"><span class="d" id="thinkdot"></span>Agent reasoning</div>
    <div class="log" id="think"><div class="t dim">The agent's decisions appear here — which provider it picks, when it judges the answer good enough, and why it stops.</div></div>
  </div>

  <div class="grid">
    <div class="stream">
      <div class="hd">Answer</div>
      <div class="answer" id="answer"><span class="ph">Your answer prints here, one paid second at a time. Stop whenever — you only pay for what you've read.</span></div>
    </div>
    <div class="fare">
      <span class="lbl">Fare</span>
      <div class="spend" id="spend">0.000000<small>USDC</small></div>
      <div class="secs">metered <b id="secs">0</b> s</div>
      <button class="stopbtn" id="stop" hidden>Tap to stop</button>
      <div class="rate" id="rate">—</div>
    </div>
  </div>

  <footer>
    <span>you pay per second · settled on Arc via Circle x402</span>
    <span id="phase">idle</span>
  </footer>
</div>

<script>
  var $=function(id){return document.getElementById(id)};
  var runId=null, es=null, running=false, started=false;

  fetch("/api/state").then(function(r){return r.json()}).then(function(s){
    $("bal").textContent=(s.balanceUsdc!=null?s.balanceUsdc:"—")+" USDC";
    $("rate").textContent=s.pricePerSecond+" USDC / sec";
    $("lamp").className="lamp on"; $("conn").textContent="PROVIDER LIVE";
  }).catch(function(){ $("lamp").className="lamp off"; $("conn").textContent="NO PROVIDER"; });

  function setRunning(on){
    running=on;
    $("stop").hidden=!on;
    $("start").disabled=on;
    $("start").textContent=on?"Streaming…":(started?"Ask again":"Start — pays per second");
  }
  function setSpend(v){
    $("spend").innerHTML=Number(v||0).toFixed(6)+'<small>USDC</small>';
    var el=$("spend"); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }
  function appendToken(t){
    var a=$("answer");
    if(!started){ a.innerHTML=""; started=true; }
    a.querySelector(".caret") && a.querySelector(".caret").remove();
    a.insertAdjacentText("beforeend", t);
    var c=document.createElement("span"); c.className="caret"; a.appendChild(c);
    a.scrollTop=a.scrollHeight;
  }
  function endCaret(){ var c=$("answer").querySelector(".caret"); if(c) c.remove(); }
  function think(t){ var log=$("think"); var d=document.createElement("div"); d.className="t"; d.textContent=t; log.appendChild(d); log.scrollTop=log.scrollHeight; }

  $("ask").addEventListener("submit", function(e){
    e.preventDefault();
    if(running) return;
    var prompt=$("prompt").value.trim(); if(!prompt) return;
    $("answer").innerHTML=""; started=false; setSpend(0); $("secs").textContent="0"; $("phase").textContent="opening";
    $("think").innerHTML=""; $("thinkdot").className="d on";
    setRunning(true);
    fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:prompt})})
      .then(function(r){return r.json()}).then(function(d){
        if(!d.runId){ $("phase").textContent="error"; setRunning(false); return; }
        runId=d.runId; listen(runId);
      }).catch(function(){ $("phase").textContent="couldn't reach buyer service"; setRunning(false); });
  });

  $("stop").addEventListener("click", function(){
    if(!runId) return;
    $("phase").textContent="stopping";
    fetch("/api/stop/"+runId,{method:"POST"});
  });

  function listen(id){
    if(es) es.close();
    es=new EventSource("/api/events/"+id);
    es.onmessage=function(m){
      var ev=JSON.parse(m.data);
      if(ev.type==="thought"){ think(ev.text); }
      else if(ev.type==="token"){ appendToken(ev.text); if(ev.spent!=null) setSpend(ev.spent); }
      else if(ev.type==="tick"){ setSpend(ev.spent); $("secs").textContent=Math.round(ev.seconds||0); }
      else if(ev.type==="status"){ $("phase").textContent=ev.phase; if(ev.spent!=null) setSpend(ev.spent); }
      else if(ev.type==="end"){
        endCaret(); setRunning(false); es.close(); $("thinkdot").className="d";
        if(ev.error){ $("phase").textContent="provider didn't answer — is it running on :19131?"; return; }
        if(ev.walked){ $("phase").textContent="walked away — price above limit"; return; }
        if(ev.stopped){
          var a=$("answer"); var cut=document.createElement("div"); cut.className="cut";
          cut.textContent="— stopped at "+(ev.seconds||0)+"s · you paid "+Number(ev.spent||0).toFixed(6)+" USDC and nothing more —";
          a.appendChild(cut); a.scrollTop=a.scrollHeight; $("phase").textContent="stopped";
        } else {
          $("phase").textContent="done — "+(ev.seconds||0)+"s, "+Number(ev.spent||0).toFixed(6)+" USDC";
        }
        fetch("/api/state").then(function(r){return r.json()}).then(function(s){ if(s.balanceUsdc!=null) $("bal").textContent=s.balanceUsdc+" USDC"; });
      }
    };
    es.onerror=function(){ /* keep open; server pings */ };
  }
</script>
</body>
</html>`;
