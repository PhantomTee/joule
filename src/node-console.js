// DePIN node operator console. You run a node; you connect your Arc wallet; you
// see what this node earned (its Circle Gateway balance), your on-chain USDC, and
// whether the connected wallet is the node's payout wallet. Served at GET /node.

export const NODE_CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Joule · node operator</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
  :root{
    --bg:#0A0F0E;--panel:#0E1413;--raised:#121A18;--window:#080C0B;--rule:#1E2A27;
    --ink:#E8F0EC;--dim:#7C918A;--meter:#FF9F1C;--meter-soft:rgba(255,159,28,.16);
    --live:#3FE0A8;--stop:#FF5C49;
    --mono:'IBM Plex Mono',ui-monospace,Consolas,monospace;--disp:'Space Grotesk',system-ui,sans-serif;
  }
  *{box-sizing:border-box}html,body{margin:0}
  body{background:radial-gradient(120% 80% at 50% -10%,#10201c 0%,var(--bg) 55%);color:var(--ink);
    font-family:var(--disp);-webkit-font-smoothing:antialiased;min-height:100vh}
  .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .wrap{max-width:1080px;margin:0 auto;padding:22px 24px 40px}
  .rail{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:18px;border-bottom:1px solid var(--rule)}
  .brand{display:flex;align-items:center;gap:14px}
  .mark{font-family:var(--mono);font-weight:600;letter-spacing:.32em;font-size:13px}
  .unit{font-family:var(--mono);font-size:11px;letter-spacing:.22em;color:var(--dim);border:1px solid var(--rule);border-radius:2px;padding:4px 8px}
  .btn{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;border-radius:9px;
    padding:11px 18px;cursor:pointer;border:1px solid var(--meter);background:transparent;color:var(--meter);
    transition:transform .06s,background .2s}
  .btn:hover{background:rgba(255,159,28,.1)}
  .btn:active{transform:scale(.98)}
  .btn:focus-visible{outline:2px solid var(--meter);outline-offset:2px}
  .addr{font-family:var(--mono);font-size:12px;color:var(--ink);letter-spacing:.04em}

  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:var(--dim);text-transform:uppercase}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:22px}
  .card{background:var(--raised);border:1px solid var(--rule);border-radius:13px;padding:18px 20px}
  .card.hero{grid-column:1 / -1;background:linear-gradient(180deg,var(--panel),#0b110f)}
  .card .k{font-family:var(--mono);font-size:11px;letter-spacing:.24em;color:var(--dim);text-transform:uppercase}
  .big{font-family:var(--mono);font-weight:600;color:var(--meter);font-size:clamp(30px,6vw,52px);line-height:1;
    margin-top:12px;font-variant-numeric:tabular-nums;text-shadow:0 0 18px var(--meter-soft)}
  .big small{font-size:.32em;letter-spacing:.2em;color:var(--dim);margin-left:.5em;text-shadow:none}
  .v{font-family:var(--mono);font-weight:500;color:var(--ink);font-size:24px;margin-top:10px;font-variant-numeric:tabular-nums}
  .s{font-family:var(--mono);font-size:11px;color:var(--dim);margin-top:6px;letter-spacing:.06em}

  .match{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:12px;letter-spacing:.06em;
    border-radius:999px;padding:4px 12px;margin-top:12px}
  .match.yes{background:rgba(63,224,168,.12);color:var(--live)}
  .match.no{background:rgba(255,92,73,.12);color:var(--stop)}
  .match .d{width:7px;height:7px;border-radius:50%;background:currentColor}

  .tape{margin-top:22px;background:var(--raised);border:1px solid var(--rule);border-radius:12px;overflow:hidden}
  .tape h2{margin:0;font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:var(--dim);text-transform:uppercase;padding:14px 18px;border-bottom:1px dashed var(--rule)}
  .row{display:grid;grid-template-columns:90px 1fr 70px 120px;gap:10px;padding:10px 18px;border-bottom:1px dashed var(--rule);font-family:var(--mono);font-size:12.5px;color:var(--dim)}
  .row:last-child{border-bottom:0}.row .amt{color:var(--meter);text-align:right}.row .who{color:var(--ink)}
  .empty{padding:20px 18px;font-family:var(--mono);font-size:12px;color:var(--dim)}
  footer{margin-top:20px;font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--dim);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  footer a{color:var(--dim);text-decoration:none;border-bottom:1px solid var(--rule)}footer a:hover{color:var(--meter)}
  @media(max-width:720px){.cards{grid-template-columns:1fr}.row{grid-template-columns:80px 1fr 90px}.row .amt:nth-child(4){display:none}}
</style>
</head>
<body>
<h2 class="sr-only">Node operator console: connect your Arc wallet to see this node's earnings and your balances.</h2>
<div class="wrap">
  <div class="rail">
    <div class="brand"><span class="mark">JOULE</span><span class="unit">NODE OPERATOR</span></div>
    <div id="walletbox"><button class="btn" id="connect">Connect wallet</button></div>
  </div>

  <div class="cards">
    <div class="card hero">
      <div class="k">This node has earned</div>
      <div class="big" id="earned">—<small>USDC</small></div>
      <div class="s">held in Circle Gateway · payout wallet <span class="addr" id="payout">—</span></div>
      <div id="matchbox"></div>
    </div>
    <div class="card"><div class="k">Your on-chain USDC</div><div class="v" id="onchain">connect wallet</div><div class="s" id="onchainsub">Arc testnet balance</div></div>
    <div class="card"><div class="k">Seconds sold</div><div class="v" id="secs">0</div><div class="s">by this node</div></div>
    <div class="card"><div class="k">Rate · model</div><div class="v" id="rate" style="font-size:16px">—</div><div class="s" id="model">—</div></div>
  </div>

  <div class="tape">
    <h2>This node's settlements</h2>
    <div id="rows"><div class="empty">no settlements yet — run a buyer to start earning</div></div>
  </div>

  <footer>
    <span>your idle machine, earning USDC per second on Arc</span>
    <a id="explorer" href="https://testnet.arcscan.app" target="_blank" rel="noreferrer">Arcscan ↗</a>
  </footer>
</div>

<script>
  var $=function(id){return document.getElementById(id)};
  var RPC="https://rpc.testnet.arc.network", USDC="0x3600000000000000000000000000000000000000";
  var node=null, account=null;
  var short=function(s){return (s&&s.length>12)?s.slice(0,6)+"…"+s.slice(-4):(s||"—")};

  async function rpc(method,params){
    var r=await fetch(RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:method,params:params})});
    return (await r.json()).result;
  }
  async function usdcOf(addr){
    try{ var data="0x70a08231"+addr.slice(2).toLowerCase().padStart(64,"0");
      var hex=await rpc("eth_call",[{to:USDC,data:data},"latest"]); return Number(BigInt(hex))/1e6; }catch(e){ return null; }
  }

  async function loadNode(){
    node=await fetch("/node-info").then(function(r){return r.json()});
    $("payout").textContent=short(node.sellerAddress);
    $("rate").textContent=node.pricePerSecond+" /sec";
    $("model").textContent=node.model;
    $("explorer").href=node.explorer+"/address/"+node.sellerAddress;
    refresh();
  }
  async function refresh(){
    try{
      var gw=await fetch("/gateway-balance").then(function(r){return r.json()});
      if(gw && gw.availableUsdc!=null) $("earned").innerHTML=Number(gw.availableUsdc).toFixed(6)+'<small>USDC</small>';
    }catch(e){}
    try{
      var s=await fetch("/stats").then(function(r){return r.json()});
      $("secs").textContent=s.earnings.totalSeconds||0;
      var rows=s.earnings.lastJobs||[];
      $("rows").innerHTML=rows.length?rows.map(function(j){
        return '<div class="row"><span>'+new Date(j.ts).toLocaleTimeString("en-GB")+'</span>'+
          '<span class="who">'+short(j.payer)+'</span><span>'+(j.seconds||0)+'s</span>'+
          '<span class="amt">+'+Number(j.amountUsdc||0).toFixed(6)+'</span></div>';
      }).join(""):'<div class="empty">no settlements yet — run a buyer to start earning</div>';
    }catch(e){}
  }

  async function connect(){
    if(!window.ethereum){
      var a=prompt("No browser wallet found. Paste an Arc address to view balances:");
      if(a){ account=a.trim(); afterConnect(); }
      return;
    }
    try{
      var accs=await window.ethereum.request({method:"eth_requestAccounts"});
      account=accs[0];
      try{ await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x4CEF52"}]}); }
      catch(sw){ if(sw.code===4902){ await window.ethereum.request({method:"wallet_addEthereumChain",params:[{
        chainId:"0x4CEF52",chainName:"Arc Testnet",nativeCurrency:{name:"USDC",symbol:"USDC",decimals:18},
        rpcUrls:[RPC],blockExplorerUrls:["https://testnet.arcscan.app"]}]}); } }
      afterConnect();
    }catch(e){ /* user rejected */ }
  }

  async function afterConnect(){
    $("walletbox").innerHTML='<span class="addr">'+short(account)+'</span>';
    var bal=await usdcOf(account);
    $("onchain").textContent=(bal==null?"—":bal.toFixed(2)+" USDC");
    $("onchainsub").textContent=short(account);
    var isNode=node && account.toLowerCase()===node.sellerAddress.toLowerCase();
    $("matchbox").innerHTML='<span class="match '+(isNode?"yes":"no")+'"><span class="d"></span>'+
      (isNode?"this is this node's payout wallet":"connected wallet is not this node's payout wallet")+'</span>';
  }

  $("connect").addEventListener("click",connect);
  loadNode();
  setInterval(refresh,3000);
</script>
</body>
</html>`;
