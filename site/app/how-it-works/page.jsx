import Link from "next/link";

export const metadata = { title: "Joule · how it works" };

export default function HowItWorks() {
  return (
    <>
      <section className="hero">
        <div className="eyebrow">the mechanism</div>
        <h1>
          Pay for exactly the <span className="g">seconds</span> you use.
        </h1>
        <p className="sub">
          No subscription, no per-call rounding. An agent opens a stream, pays one tiny USDC tick per second of compute,
          and stops the instant it has enough. The provider only gives away what was paid for.
        </p>
      </section>

      <div className="flow">
        <div className="node">
          <div className="t">Agent asks</div>
          <div className="d">hits the node&apos;s endpoint with a prompt</div>
        </div>
        <div className="arrow">→</div>
        <div className="node">
          <div className="t">402 → pay</div>
          <div className="d">node replies &quot;payment required&quot;; agent signs a USDC tick</div>
        </div>
        <div className="arrow">→</div>
        <div className="node">
          <div className="t">Stream + meter</div>
          <div className="d">tokens stream; each second is one paid pull</div>
        </div>
      </div>
      <div className="flow" style={{ gridTemplateColumns: "1fr auto 1fr", marginTop: 8 }}>
        <div className="node">
          <div className="t">Tap to stop</div>
          <div className="d">agent stops paying → model is freed instantly</div>
        </div>
        <div className="arrow">→</div>
        <div className="node">
          <div className="t">Settle on Arc</div>
          <div className="d">ticks batch off-chain, settle as USDC on Arc</div>
        </div>
      </div>

      <h2>The x402 handshake</h2>
      <p className="body">
        The first request gets an HTTP <code>402 Payment Required</code> with the terms (asset = USDC, network = Arc,
        price for this tick). The agent signs a USDC authorization from its Circle Gateway balance and retries — the node
        verifies, settles, and serves. <b>No API key, no account.</b> Money is the key.
      </p>

      <h2>Per-second metering + tap-to-stop</h2>
      <p className="body">
        Each &quot;pull&quot; buys one tick (~one second) of streaming. The model is held server-side with backpressure
        so it <b>can&apos;t run ahead of payment</b>. The moment the agent stops pulling, generation halts and the node
        frees the GPU — so you only ever pay for the seconds you actually consumed.
      </p>

      <h2>Two autonomous agents</h2>
      <p className="body">
        A <b>provider pricing agent</b> quotes a per-second price that surges under load and discounts when the machine
        is idle. A <b>buyer agent</b> discovers providers, walks away if the price is over its limit, streams, and{" "}
        <b>judges the answer each second</b> — stopping on its own when it&apos;s good enough or the budget is hit. Both
        narrate their reasoning.
      </p>

      <h2>Settlement</h2>
      <p className="body">
        Sub-cent ticks are economical because Circle Gateway <b>batches</b> them off-chain and settles as a single
        transaction on Arc (sub-second finality, USDC-native gas). Operators withdraw their accrued balance to chain
        whenever they like.
      </p>

      <div className="cta" style={{ marginTop: 34 }}>
        <Link className="btn" href="/operators">
          Run a node →
        </Link>
        <Link className="ghost" href="/agents">
          Build on it →
        </Link>
      </div>
    </>
  );
}
