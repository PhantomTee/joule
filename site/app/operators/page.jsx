import Link from "next/link";

export const metadata = { title: "Joule · operators" };

export default function Operators() {
  return (
    <>
      <section className="hero">
        <div className="eyebrow">for hardware owners</div>
        <h1>
          Run a node. <span className="g">Earn while idle.</span>
        </h1>
        <p className="sub">
          Your machine sits idle most of the day. Point Joule at your wallet and that spare GPU/CPU starts serving paid
          inference to agents — you keep what you meter, and you can stop any time.
        </p>
        <div className="cta">
          <a className="btn" href="https://github.com/PhantomTee/joule/releases/latest">
            Download the node ↓
          </a>
        </div>
      </section>

      <h2>Three steps</h2>
      <div className="grid3">
        <div className="card">
          <div className="n">01</div>
          <h3>Run it</h3>
          <p>
            Double-click <code>joule-node.exe</code> — no install, no Node. It fetches a model on first launch.
          </p>
        </div>
        <div className="card">
          <div className="n">02</div>
          <h3>Point it at your wallet</h3>
          <p>
            Drop a <code>.env</code> with <code>SELLER_ADDRESS=</code> your Arc wallet next to the exe. Earnings land
            there.
          </p>
        </div>
        <div className="card">
          <div className="n">03</div>
          <h3>Earn while idle</h3>
          <p>Open the operator console and watch USDC accrue per second as agents hit your node.</p>
        </div>
      </div>

      <h2>You set the terms</h2>
      <p className="body">
        Your node prices itself with a <b>pricing agent</b> — it surges when busy and discounts when your machine is idle
        to attract work. You can require the machine be genuinely idle before it serves, so paid inference only ever runs
        on truly spare capacity. <b>You keep what you meter</b>; withdraw your Gateway balance to chain whenever.
      </p>

      <h2>The operator console</h2>
      <p className="body">
        Connect your wallet and the console shows this node&apos;s earnings (its Circle Gateway balance), your on-chain
        USDC, seconds sold, and a live tape of settlements — each linkable on Arcscan. It confirms the connected wallet
        is the node&apos;s payout wallet, so you always know the money&apos;s coming to you.
      </p>

      <h2>Join the network</h2>
      <p className="body">
        Set <code>COORDINATOR_URL</code> and your node announces itself <b>outbound</b> — no port-forwarding — so it
        appears on the network and buyer agents can discover it alongside other nodes.{" "}
        <Link href="/network" style={{ color: "var(--meter)" }}>
          See the network →
        </Link>
      </p>

      <div className="cta" style={{ marginTop: 34 }}>
        <a className="btn" href="https://github.com/PhantomTee/joule/releases/latest">
          Get the node ↓
        </a>
        <Link className="ghost" href="/how-it-works">
          How it works →
        </Link>
      </div>
    </>
  );
}
