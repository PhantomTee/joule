// Zero-setup "try it" page — a free, capped taste of the node's inference with no
// wallet and no account, so anyone can feel it instantly. Served at GET /try.
export const TRY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Joule · try it free</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
  :root{
    --bg:#0A0F0E;--window:#080C0B;--raised:#121A18;--rule:#1E2A27;--ink:#E8F0EC;--dim:#7C918A;
    --meter:#FF9F1C;--meter-soft:rgba(255,159,28,.16);--live:#3FE0A8;
    --mono:'IBM Plex Mono',ui-monospace,Consolas,monospace;--disp:'Space Grotesk',system-ui,sans-serif;
  }
  *{box-sizing:border-box}html,body{margin:0}
  body{background:radial-gradient(120% 70% at 50% -10%,#15110a 0%,var(--bg) 55%);color:var(--ink);
    font-family:var(--disp);-webkit-font-smoothing:antialiased;min-height:100vh}
  .wrap{max-width:760px;margin:0 auto;padding:26px 24px 60px}
  .rail{display:flex;justify-content:space-between;align-items:center;padding-bottom:18px;border-bottom:1px solid var(--rule)}
  .mark{font-family:var(--mono);font-weight:600;letter-spacing:.3em;font-size:13px}
  .nav{font-family:var(--mono);font-size:11px;letter-spacing:.14em}
  .nav a{color:var(--dim);text-decoration:none;margin-left:14px}.nav a:hover{color:var(--meter)}
  h1{font-size:clamp(30px,5vw,46px);line-height:1.05;letter-spacing:-.02em;margin:34px 0 0;max-width:18ch;font-weight:700}
  h1 .g{color:var(--meter)}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.32em;color:var(--live);text-transform:uppercase;margin-top:30px}
  .sub{font-family:var(--mono);color:var(--dim);font-size:14px;line-height:1.7;margin:16px 0 0;max-width:56ch}
  .ask{display:flex;gap:10px;margin-top:26px}
  .ask input{flex:1;background:var(--window);border:1px solid var(--rule);border-radius:11px;color:var(--ink);
    font-family:var(--mono);font-size:14px;padding:14px 16px;outline:none}
  .ask input:focus-visible{border-color:var(--meter)}
  .go{font-family:var(--mono);font-size:13px;letter-spacing:.1em;text-transform:uppercase;font-weight:500;color:#04140f;
    background:linear-gradient(95deg,var(--meter),#ffc05a);border:0;border-radius:11px;padding:14px 22px;cursor:pointer}
  .go:disabled{opacity:.55;cursor:progress}
  .out{margin-top:18px;background:var(--window);border:1px solid #16201d;border-radius:12px;min-height:140px;
    padding:20px 22px;font-family:var(--mono);font-size:15px;line-height:1.75;white-space:pre-wrap;word-break:break-word;
    box-shadow:inset 0 2px 18px rgba(0,0,0,.6)}
  .out .ph{color:var(--dim)}
  .caret{display:inline-block;width:8px;height:1em;background:var(--meter);vertical-align:-2px;animation:blink 1s steps(1) infinite}
  @keyframes blink{50%{opacity:0}}
  .note{margin-top:22px;font-family:var(--mono);font-size:12.5px;color:var(--dim);line-height:1.7;
    border-left:2px solid var(--meter);padding-left:14px}
  .note b{color:var(--ink);font-weight:500}
  .note a{color:var(--meter);text-decoration:none}
  footer{margin-top:30px;font-family:var(--mono);font-size:11px;color:var(--dim);letter-spacing:.06em}
  @media(prefers-reduced-motion:reduce){.caret{animation:none}}
</style>
</head>
<body>
<div class="wrap">
  <div class="rail"><span class="mark">JOULE</span><span class="nav"><a href="/">meter</a><a href="/node">operator</a></span></div>

  <div class="eyebrow">free taste · no wallet, no account</div>
  <h1>Ask a node running on <span class="g">idle compute</span>.</h1>
  <p class="sub">This one's on the house — a short answer straight from a real node's local model. When an agent uses it for real, it pays per second of compute in USDC on Arc. No keys, no signup. Money is the API key.</p>

  <form class="ask" id="ask" autocomplete="off">
    <input id="q" placeholder="Ask anything…" value="Explain what Circle Arc is in one sentence." />
    <button class="go" id="run" type="submit">Run free</button>
  </form>

  <div class="out" id="out"><span class="ph">The node's answer prints here.</span></div>

  <p class="note">This free demo is capped and rate-limited. The real thing meters <b>~0.0002 USDC / second</b> and you can <b>tap to stop</b> any time — see the <a href="/">live earnings meter</a>, or point an agent at this node's <a href="/agent-card">/agent-card</a>.</p>

  <footer>running on this operator's own hardware · settled via Circle x402 on Arc</footer>
</div>

<script>
  var $=function(id){return document.getElementById(id)};
  $("ask").addEventListener("submit", async function(e){
    e.preventDefault();
    var q=$("q").value.trim(); if(!q) return;
    var b=$("run"); b.disabled=true;
    var out=$("out"); out.innerHTML='<span class="caret"></span>'; var text="";
    try{
      var res=await fetch("/v1/demo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:q})});
      if(res.status===429){ out.textContent="(the free demo is busy — try again in a second, or run a real paid session)"; b.disabled=false; return; }
      var reader=res.body.getReader(), dec=new TextDecoder();
      while(true){ var r=await reader.read(); if(r.done) break; text+=dec.decode(r.value,{stream:true}); out.innerHTML=text.replace(/</g,"&lt;")+'<span class="caret"></span>'; out.scrollTop=out.scrollHeight; }
      out.innerHTML=text.replace(/</g,"&lt;") || "(no output — is the model running?)";
    }catch(err){ out.textContent="couldn't reach the node: "+err.message; }
    b.disabled=false;
  });
</script>
</body>
</html>`;
