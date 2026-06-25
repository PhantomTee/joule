"use client";

import { useEffect, useState } from "react";

const COORDINATOR = "https://joule-coordinator.onrender.com";

// Representative numbers only — shown when nothing's actually online, never
// blended with real data, and always labeled as an example.
const EXAMPLE_NODES = [
  { id: "ex-1", name: "Maya's Mac", kind: "native", model: "qwen2.5:1.5b", pricePerSecond: 0.00085, secondsSold: 4120, earnedUsdc: 3.5 },
  { id: "ex-2", name: "browser node", kind: "lite", model: "Qwen2.5-1.5B-Instruct", pricePerSecond: 0.0006, secondsSold: 980, earnedUsdc: 0.59 },
];

function fmt(n, d = 4) {
  const v = Number(n) || 0;
  return v.toFixed(d).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

export default function LiveNetwork() {
  const [state, setState] = useState({ loading: true, nodes: [], error: false });

  useEffect(() => {
    let dead = false;
    async function poll() {
      try {
        const r = await fetch(`${COORDINATOR}/nodes`, { signal: AbortSignal.timeout(20000) });
        const j = await r.json();
        if (!dead) setState({ loading: false, nodes: j.nodes || [], error: false });
      } catch {
        if (!dead) setState((s) => ({ ...s, loading: false, error: true }));
      }
    }
    poll();
    const t = setInterval(poll, 20000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);

  const live = state.nodes;
  const showingExample = !state.loading && live.length === 0;
  const rows = showingExample ? EXAMPLE_NODES : live;
  const totalEarned = rows.reduce((a, n) => a + (Number(n.earnedUsdc) || 0), 0);
  const totalSeconds = rows.reduce((a, n) => a + (Number(n.secondsSold) || 0), 0);

  return (
    <div className="live-net">
      <div className="live-net-head">
        <h2 style={{ margin: 0 }}>The network, right now</h2>
        {!showingExample && !state.loading && (
          <span className="live-dot">
            <i /> live · reading {COORDINATOR.replace("https://", "")}
          </span>
        )}
      </div>

      {state.loading && <p className="body">waking up the network directory…</p>}

      {!state.loading && (
        <>
          {showingExample && (
            <p className="body" style={{ marginTop: 4 }}>
              No nodes are online this moment — the network is just whoever's running{" "}
              <code>joule-node.exe</code> or the browser extension right now. Here's an
              example of what this looks like with nodes live (clearly marked, not real):
            </p>
          )}
          <div className="stats" style={{ justifyContent: "flex-start", padding: "20px 0" }}>
            <div className="grid" style={{ textAlign: "left" }}>
              <div className="stat">
                <div className="num">{rows.length}</div>
                <div className="lab">{"nodes\nonline"}</div>
              </div>
              <div className="stat">
                <div className="num">
                  <i>$</i>
                  {fmt(totalEarned, 4)}
                </div>
                <div className="lab">{"usdc\nsettled"}</div>
              </div>
              <div className="stat">
                <div className="num">{Math.round(totalSeconds)}</div>
                <div className="lab">{"seconds\nsold"}</div>
              </div>
            </div>
          </div>

          <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {rows.map((n) => (
              <div className="card" key={n.id}>
                <div className="n">{n.kind === "lite" ? "browser node" : "native node"}{showingExample ? " · example" : ""}</div>
                <h3>{n.name}</h3>
                <p>
                  {n.model} · ${fmt(n.pricePerSecond, 6)}/sec
                  <br />
                  {Math.round(n.secondsSold || 0)}s sold · ${fmt(n.earnedUsdc, 4)} earned
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
