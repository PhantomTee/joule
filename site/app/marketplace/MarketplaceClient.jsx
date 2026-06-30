"use client";

import { useState, useEffect, useCallback } from "react";

const COORD = "https://joule-coordinator.onrender.com";

function short(addr) {
  if (!addr) return "—";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function badge(n) {
  if (n.kind === "lite") return <span style={styles.liteBadge}>lite</span>;
  return null;
}

function ScoreBar({ value, max = 100, color = "#3FE0A8" }) {
  return (
    <div style={{ background: "#1E2A27", borderRadius: 4, height: 4, overflow: "hidden", marginTop: 4 }}>
      <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.4s" }} />
    </div>
  );
}

export default function MarketplaceClient() {
  const [nodes, setNodes]   = useState([]);
  const [sort, setSort]     = useState("earnings");
  const [filter, setFilter] = useState("");
  const [loading, setLoading]   = useState(true);
  const [stats, setStats]   = useState(null);
  const [selected, setSelected] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await fetch(`${COORD}/nodes`).then((r) => r.json());
      setNodes(d.nodes || []);
      const allNodes = d.nodes || [];
      const prices = allNodes.map((n) => n.pricePerSecond).filter(Boolean);
      setStats({
        count: allNodes.length,
        totalEarned: allNodes.reduce((s, n) => s + Number(n.earnedUsdc || 0), 0),
        totalSecs: allNodes.reduce((s, n) => s + Number(n.secondsSold || 0), 0),
        avgPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
        activeSessions: allNodes.reduce((s, n) => s + (n.activeSessions || 0), 0),
      });
      setLastRefresh(new Date());
    } catch {
      // keep stale data
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
    <div style={styles.root}>
      {/* ── stat band ── */}
      {stats && (
        <div style={styles.band}>
          <Stat label="providers" value={stats.count} />
          <Stat label="total earned" value={`${stats.totalEarned.toFixed(4)} USDC`} />
          <Stat label="seconds sold" value={stats.totalSecs.toLocaleString()} />
          <Stat label="avg price" value={stats.avgPrice ? `${stats.avgPrice.toFixed(6)}/sec` : "—"} />
          <Stat label="live sessions" value={stats.activeSessions} accent />
        </div>
      )}

      {/* ── controls ── */}
      <div style={styles.controls}>
        <input
          placeholder="filter by model or name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={styles.search}
        />
        <div style={styles.sortRow}>
          {["earnings", "price", "seconds"].map((s) => (
            <button key={s} onClick={() => setSort(s)} style={{ ...styles.sortBtn, ...(sort === s ? styles.sortActive : {}) }}>
              {s}
            </button>
          ))}
          <span style={styles.refreshTime}>
            {lastRefresh ? `updated ${lastRefresh.toLocaleTimeString()}` : "loading…"}
          </span>
        </div>
      </div>

      {/* ── grid ── */}
      {loading ? (
        <p style={styles.empty}>connecting to coordinator…</p>
      ) : filtered.length === 0 ? (
        <div style={styles.emptyBox}>
          <p style={{ margin: 0, color: "var(--dim)" }}>No providers match your filter.</p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--dim)" }}>
            Start a node with <code style={{ color: "var(--ink)" }}>npm start</code> to join the network.
          </p>
        </div>
      ) : (
        <div style={styles.grid}>
          {filtered.map((n) => (
            <NodeCard key={n.id} node={n} selected={selected === n.id} onClick={() => setSelected(selected === n.id ? null : n.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={styles.stat}>
      <span style={{ ...styles.statVal, ...(accent ? { color: "#3FE0A8" } : {}) }}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  );
}

function NodeCard({ node: n, selected, onClick }) {
  const busy = (n.activeSessions || 0) > 0;
  return (
    <div style={{ ...styles.card, ...(selected ? styles.cardSelected : {}) }} onClick={onClick}>
      <div style={styles.cardTop}>
        <div style={styles.nameRow}>
          <span style={styles.nodeName}>{n.name}</span>
          {n.kind === "lite" && <span style={styles.liteBadge}>lite</span>}
        </div>
        <span style={{ ...styles.dot, ...(busy ? styles.dotBusy : {}) }} />
      </div>
      <div style={styles.model}>{n.model}</div>
      <div style={styles.price}>
        {n.pricePerSecond != null ? n.pricePerSecond : "—"}
        <span style={styles.priceUnit}> USDC/sec</span>
      </div>
      <div style={styles.statRow}>
        <span><strong style={{ color: "var(--ink)" }}>{Number(n.secondsSold || 0).toLocaleString()}</strong> sec</span>
        <span><strong style={{ color: "var(--ink)" }}>{Number(n.earnedUsdc || 0).toFixed(4)}</strong> USDC</span>
        <span><strong style={{ color: busy ? "#FF9F1C" : "var(--ink)" }}>{n.activeSessions || 0}</strong> live</span>
      </div>
      <div style={styles.addr}>payout {short(n.sellerAddress)}</div>

      {/* Expanded detail */}
      {selected && (
        <div style={styles.detail}>
          <hr style={{ border: "none", borderTop: "1px solid #1E2A27", margin: "12px 0" }} />
          <DetailRow label="node id"    value={n.id} />
          <DetailRow label="joined"     value={n.joinedAt ? new Date(n.joinedAt).toLocaleString() : "—"} />
          <DetailRow label="full address" value={n.sellerAddress || "—"} mono />
          <DetailRow label="kind"       value={n.kind || "native"} />
          {n.url && <DetailRow label="endpoint" value={n.url} link />}
          <div style={{ marginTop: 12 }}>
            <span style={styles.metaLabel}>uptime est.</span>
            <ScoreBar value={n.activeSessions != null ? 90 : 50} />
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono, link }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 11, fontFamily: "var(--mono)" }}>
      <span style={{ color: "var(--dim)" }}>{label}</span>
      {link
        ? <a href={value} target="_blank" rel="noreferrer" style={{ color: "#3FE0A8" }}>{value}</a>
        : <span style={{ color: "var(--ink)", wordBreak: "break-all", maxWidth: "60%", textAlign: "right", ...(mono ? { fontFamily: "var(--mono)" } : {}) }}>{value}</span>
      }
    </div>
  );
}

function ScoreBar({ value, max = 100, color = "#3FE0A8" }) {
  return (
    <div style={{ background: "#1E2A27", borderRadius: 4, height: 4, overflow: "hidden", marginTop: 4 }}>
      <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.4s" }} />
    </div>
  );
}

const styles = {
  root:     { padding: "0 0 64px" },
  band:     { display: "flex", gap: 32, flexWrap: "wrap", margin: "0 0 24px", padding: "18px 0", borderBottom: "1px solid #1E2A27" },
  stat:     { display: "flex", flexDirection: "column", gap: 2 },
  statVal:  { fontFamily: "var(--mono)", fontWeight: 600, fontSize: 20, color: "var(--ink)" },
  statLabel:{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)", letterSpacing: ".08em", textTransform: "uppercase" },
  controls: { marginBottom: 20 },
  search:   { width: "100%", maxWidth: 360, padding: "8px 12px", background: "#121A18", border: "1px solid #1E2A27", borderRadius: 8, color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 13, outline: "none", marginBottom: 10 },
  sortRow:  { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  sortBtn:  { padding: "4px 12px", borderRadius: 6, border: "1px solid #1E2A27", background: "transparent", color: "var(--dim)", fontFamily: "var(--mono)", fontSize: 12, cursor: "pointer", letterSpacing: ".06em" },
  sortActive: { background: "#1E2A27", color: "var(--ink)", borderColor: "#2E3A37" },
  refreshTime: { marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)" },
  grid:     { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 14 },
  card:     { background: "#121A18", border: "1px solid #1E2A27", borderRadius: 13, padding: "18px 18px 14px", cursor: "pointer", transition: "border-color .2s" },
  cardSelected: { borderColor: "#3FE0A8" },
  cardTop:  { display: "flex", alignItems: "center", justifyContent: "space-between" },
  nameRow:  { display: "flex", alignItems: "center", gap: 6 },
  nodeName: { fontFamily: "var(--mono)", fontWeight: 600, fontSize: 14 },
  liteBadge:{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".12em", color: "#3FE0A8", border: "1px solid #3FE0A8", borderRadius: 999, padding: "1px 6px", textTransform: "uppercase" },
  dot:      { width: 8, height: 8, borderRadius: "50%", background: "#3FE0A8", boxShadow: "0 0 8px #3FE0A8", animation: "pulse 1.4s ease-in-out infinite" },
  dotBusy:  { background: "#FF9F1C", boxShadow: "0 0 8px #FF9F1C" },
  model:    { fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)", marginTop: 8, letterSpacing: ".04em" },
  price:    { fontFamily: "var(--mono)", fontWeight: 600, color: "#FF9F1C", fontSize: 22, marginTop: 14, fontVariantNumeric: "tabular-nums" },
  priceUnit:{ fontSize: "0.5em", color: "var(--dim)", letterSpacing: ".1em" },
  statRow:  { display: "flex", gap: 16, marginTop: 12, fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)" },
  addr:     { fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", marginTop: 10, letterSpacing: ".04em" },
  detail:   { marginTop: 4 },
  metaLabel:{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)", letterSpacing: ".06em", textTransform: "uppercase" },
  empty:    { fontFamily: "var(--mono)", color: "var(--dim)", fontSize: 13 },
  emptyBox: { border: "1px dashed #1E2A27", borderRadius: 12, padding: 26, textAlign: "center", fontFamily: "var(--mono)" },
};
