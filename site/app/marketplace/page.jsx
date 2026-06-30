import MarketplaceClient from "./MarketplaceClient";

export const metadata = {
  title: "Marketplace · Joule",
  description: "Browse and rank live inference providers on the Joule network. Sort by earnings, price, or uptime.",
};

export default function MarketplacePage() {
  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "48px 24px 0",
        fontFamily: "var(--disp, system-ui, sans-serif)",
        color: "var(--ink, #E8F0EC)",
      }}
    >
      {/* ── Header ── */}
      <div style={{ marginBottom: 40 }}>
        <p
          style={{
            fontFamily: "var(--mono, monospace)",
            fontSize: 11,
            letterSpacing: ".2em",
            color: "var(--dim, #7C918A)",
            textTransform: "uppercase",
            margin: "0 0 12px",
          }}
        >
          Joule · Marketplace
        </p>
        <h1
          style={{
            fontSize: "clamp(28px, 4vw, 46px)",
            fontWeight: 700,
            letterSpacing: "-.02em",
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          Inference providers,{" "}
          <span style={{ color: "#FF9F1C" }}>ranked by reputation</span>
        </h1>
        <p
          style={{
            fontFamily: "var(--mono, monospace)",
            color: "var(--dim, #7C918A)",
            fontSize: 13,
            marginTop: 14,
            maxWidth: 560,
            lineHeight: 1.6,
          }}
        >
          Live nodes selling idle GPU/CPU time per second. Buyer agents discover the
          best provider by price, latency, and earnings history — then pay in USDC
          on Arc, one second at a time.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
          <a
            href="/operators"
            style={{
              padding: "10px 20px",
              background: "#FF9F1C",
              color: "#0A0F0E",
              borderRadius: 8,
              fontFamily: "var(--mono, monospace)",
              fontWeight: 600,
              fontSize: 13,
              textDecoration: "none",
              letterSpacing: ".04em",
            }}
          >
            become a provider →
          </a>
          <a
            href="/agents"
            style={{
              padding: "10px 20px",
              background: "transparent",
              color: "var(--ink, #E8F0EC)",
              border: "1px solid #1E2A27",
              borderRadius: 8,
              fontFamily: "var(--mono, monospace)",
              fontSize: 13,
              textDecoration: "none",
              letterSpacing: ".04em",
            }}
          >
            buy inference →
          </a>
        </div>
      </div>

      {/* ── Live data (client component) ── */}
      <MarketplaceClient />
    </main>
  );
}
