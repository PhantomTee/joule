"use client";

import { useState, useEffect, useCallback } from "react";

const COORD = "https://joule-coordinator.onrender.com";

function short(addr) {
  if (!addr) return "-";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function ScoreBar({ value, max = 100 }) {
  return (
    <div style={{ background: "var(--accent-soft)", borderRadius: 4, height: 4, overflow: "hidden", marginTop: 4 }}>
      <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: "100%", background: "var(--accent)", borderRadius: 4, transition: "width 0.4s" }} />
    </div>
  );
}

function exportCsv(nodes) {
  const cols = ["id", "name", "model", "pricePerSecond", "earnedUsdc", "secondsSold", "activeSessions", "sellerAddress", "kind"];
  const header = cols.join(",");
  const rows = nodes.map((n) => cols.map((c) => JSON.stringify(n[c] ?? "")).join(","));
  const csv = [header, ...rows].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `joule-providers-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MarketplaceClient() {
  const [nodes, setNodes]             = useState([]);
  const [sort, setSort]               = useState("earnings");
  const [filter, setFilter]           = useState("");
  const [loading, setLoading]         = useState(true);
  const [stats, setStats]             = useState(null);
  const [selected, setSelected]       = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await fetch(`${COORD}/nodes`).then((r) => r.json());
      const allNodes = d.nodes || [];
      setNodes(allNodes);
      const prices = allNodes.map((n) => n.pricePerSecond).filter(Boolean);
      setStats({
        count:          allNodes.length,
        totalEarned:    allNodes.reduce((s, n) => s + Number(n.earnedUsdc || 0), 0),
        totalSecs:      allNodes.reduce((s, n) => s + Number(n.secondsSold || 0), 0),
        avgPrice:       prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
        activeSessions: allNodes.reduce((s, n) => s + (n.activeSessions || 0), 0),
      });
      setLastRefresh(new Date());
    } catch {
      // keep stale data on transient error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = nodes
    .filter((n) => !filter || (n.model || "").toLowerCase().includes(filter.toLowerCase()) || (n.name || "").toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      if (sort === "price")    return (a.pricePerSecond || 0) - (b.pricePerSecond || 0);
      if (sort === "earnings") return Number(b.earnedUsdc || 0) - Number(a.earnedUsdc || 0);
      if (sort === "seconds")  return Number(b.secondsSold || 0) - Number(a.secondsSold || 0);
      return 0;
    });

  return (
    <div style={{ padding: "0 0 64px" }}>
      {/* ── stat band ── */}
      {stats && (
        <div style={styles.band}>
          <Stat label="providers"     value={stats.count} />
          <Stat label="total earned"  value={`${stats.totalEarned.toFixed(4)} USDC`} />
          <Stat label="seconds sold"  value={stats.totalSecs.toLocaleString()} />
          <Stat label="avg price"     value={stats.avgPrice ? `${stats.avgPrice.toFixed(6)}/sec` : "-"} />
          <Stat label="live sessions" value={stats.activeSessions} accent />
        </div>
      )}

      {/* ── controls ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={styles.searchRow}>
          <input
            placeholder="filter by model or name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={styles.search}
          />
          <button
            onClick={() => exportCsv(filtered)}
            className="ghost"
            style={{ fontFamily: "var(--mono)", fontSize: 12, letterSpacing: ".06em", whiteSpace: "nowrap", padding: "7px 14px" }}
            title="Download provider list as CSV"
          >
            ↓ CSV
          </button>
        </div>
        <div style={styles.sortRow}>
          {["earnings", "price", "seconds"].map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              style={{ ...styles.sortBtn, ...(sort === s ? styles.sortActive : {}) }}
            >
              {s}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)" }}>
            {lastRefresh ? `updated ${lastRefresh.toLocaleTimeString()}` : "loading…"}
          </span>
        </div>
      </div>

      {/* ── grid ── */}
      {loading ? (
        <p className="body">connecting to coordinator…</p>
      ) : filtered.length === 0 ? (
        <div style={styles.emptyBox}>
          <p style={{ margin: 0, color: "var(--dim)" }}>No providers match your filter.</p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--dim)" }}>
            Start a node with <code>npm start</code> to join the network.
          </p>
        </div>
      ) : (
        <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))" }}>
          {filtered.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              selected={selected === n.id}
              onClick={() => setSelected(selected === n.id ? null : n.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 100 }}>
      <span style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 20, color: accent ? "var(--accent)" : "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)", letterSpacing: ".08em", textTransform: "uppercase" }}>
        {label}
      </span>
    </div>
  );
}

function NodeCard({ node: n, selected, onClick }) {
  const busy = (n.activeSessions || 0) > 0;
  return (
    <div
      className="card"
      style={{ cursor: "pointer", padding: "18px 18px 14px", ...(selected ? { borderColor: "var(--accent)", transform: "translateY(-2px)" } : {}) }}
      onClick={onClick}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{n.name}</span>
          {n.kind === "lite" && (
            <span className="n" style={{ border: "1px solid var(--accent)", borderRadius: 999, padding: "1px 6px", fontSize: 9, letterSpacing: ".12em" }}>lite</span>
          )}
        </div>
        <span style={{ ...styles.dot, ...(busy ? styles.dotBusy : {}) }} />
      </div>

      <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)", marginTop: 8, letterSpacing: ".04em" }}>{n.model}</div>

      <div style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--accent)", fontSize: 22, marginTop: 14, fontVariantNumeric: "tabular-nums" }}>
        {n.pricePerSecond != null ? n.pricePerSecond : "-"}
        <span style={{ fontSize: "0.5em", color: "var(--dim)", letterSpacing: ".1em" }}> USDC/sec</span>
      </div>

      {n.priceReason && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", marginTop: 4, lineHeight: 1.4, letterSpacing: ".02em" }}>
          {n.priceReason}
        </div>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 12, fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)", flexWrap: "wrap" }}>
        <span><strong style={{ color: "var(--ink)" }}>{Number(n.secondsSold || 0).toLocaleString()}</strong> sec</span>
        <span><strong style={{ color: "var(--ink)" }}>{Number(n.earnedUsdc || 0).toFixed(4)}</strong> USDC</span>
        <span><strong style={{ color: busy ? "var(--accent)" : "var(--ink)" }}>{n.activeSessions || 0}</strong> live</span>
      </div>

      <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", marginTop: 10, letterSpacing: ".04em" }}>
        payout {short(n.sellerAddress)}
      </div>

      {/* Expanded detail */}
      {selected && (
        <div style={{ marginTop: 4 }}>
          <hr style={{ border: "none", borderTop: "1px solid var(--rule)", margin: "12px 0" }} />
          <DetailRow label="node id"      value={n.id} />
          <DetailRow label="joined"       value={n.joinedAt ? new Date(n.joinedAt).toLocaleString() : "-"} />
          <DetailRow label="full address" value={n.sellerAddress || "-"} mono />
          <DetailRow label="kind"         value={n.kind || "native"} />
          {n.url && <DetailRow label="endpoint" value={n.url} link />}
          {n.priceMultiplier != null && (
            <DetailRow label="price multiplier" value={`${n.priceMultiplier}×`} />
          )}
          <div style={{ marginTop: 12 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)", letterSpacing: ".06em", textTransform: "uppercase" }}>capacity</span>
            <ScoreBar value={busy ? 100 - (n.activeSessions || 0) * 20 : 90} />
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono, link }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 11, fontFamily: "var(--mono)" }}>
      <span style={{ color: "var(--dim)", flexShrink: 0, marginRight: 12 }}>{label}</span>
      {link
        ? <a href={value} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>{value}</a>
        : <span style={{ color: "var(--ink)", wordBreak: "break-all", textAlign: "right", ...(mono ? { fontFamily: "var(--mono)" } : {}) }}>{value}</span>
      }
    </div>
  );
}

const styles = {
  band:       { display: "flex", gap: "16px 32px", flexWrap: "wrap", margin: "0 0 24px", padding: "18px 0", borderBottom: "1px solid var(--rule)", overflowX: "auto" },
  searchRow:  { display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" },
  search:     { flex: "1 1 200px", maxWidth: 360, padding: "8px 12px", background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: 8, color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 13, outline: "none" },
  sortRow:    { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  sortBtn:    { padding: "4px 12px", borderRadius: 6, border: "1px solid var(--rule)", background: "transparent", color: "var(--dim)", fontFamily: "var(--mono)", fontSize: 12, cursor: "pointer", letterSpacing: ".06em" },
  sortActive: { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" },
  dot:        { width: 8, height: 8, borderRadius: "50%", background: "var(--ok)", boxShadow: "0 0 0 3px rgba(22,163,74,.18)", flexShrink: 0 },
  dotBusy:    { background: "var(--accent-2)", boxShadow: "0 0 0 3px rgba(139,92,246,.18)" },
  emptyBox:   { border: "1px dashed var(--rule)", borderRadius: 12, padding: 26, textAlign: "center", fontFamily: "var(--mono)" },
};
