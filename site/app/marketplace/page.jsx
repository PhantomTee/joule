import MarketplaceClient from "./MarketplaceClient";

export const metadata = {
  title: "Marketplace · Joule",
  description: "Browse and rank live inference providers on the Joule network. Sort by earnings, price, or uptime.",
};

export default function MarketplacePage() {
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px 0" }}>
      {/* ── Header ── */}
      <div className="hero" style={{ padding: "0 0 40px" }}>
        <p className="eyebrow">Joule · Marketplace</p>
        <h1>
          Inference providers,{" "}
          <span className="g">ranked by reputation</span>
        </h1>
        <p className="sub">
          Live nodes selling idle GPU/CPU time per second. Buyer agents discover the
          best provider by price, latency, and earnings history, then pay in USDC
          on Arc, one second at a time.
        </p>
        <div className="cta">
          <a href="/operators" className="btn">become a provider →</a>
          <a href="/agents" className="ghost">buy inference →</a>
        </div>
      </div>

      {/* ── Live data (client component) ── */}
      <MarketplaceClient />
    </main>
  );
}
