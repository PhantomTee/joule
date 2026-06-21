import Link from "next/link";
import Meter from "./components/Meter";

export default function Home() {
  return (
    <>
      <section className="hero center">
        <div className="eyebrow">DePIN · pay-per-second inference on Arc</div>
        <h1>
          Your idle machine is a <span className="g">USDC faucet</span>.
        </h1>
        <p className="sub">
          Run one file and your spare GPU/CPU starts answering AI requests for agents — earning USDC by the second,
          settled on Arc, no human in the loop. The buyers are agents too: they discover your node, pay per second, and
          stop when they have enough.
        </p>
        <Meter />
        <div className="cta">
          <a className="btn" href="https://github.com/PhantomTee/joule/releases/latest">
            Download the node ↓
          </a>
          <Link className="ghost" href="/how-it-works">
            How it works
          </Link>
        </div>
        <p className="sub" style={{ fontSize: 11, marginTop: 14 }}>
          Windows · ~86 MB · the model downloads once on first run
        </p>
      </section>

      <h2>Three ways in</h2>
      <div className="grid3">
        <Link className="card" href="/operators">
          <div className="n">EARN</div>
          <h3>Operators</h3>
          <p>Have idle hardware? Run a node and sell your spare compute by the second.</p>
          <span className="more">Run a node →</span>
        </Link>
        <Link className="card" href="/agents">
          <div className="n">BUILD</div>
          <h3>Agents</h3>
          <p>Need inference? Pay per second in USDC. No accounts, no API keys — money is the key.</p>
          <span className="more">Use the API →</span>
        </Link>
        <Link className="card" href="/network">
          <div className="n">CONNECT</div>
          <h3>Network</h3>
          <p>Nodes register outbound; buyer agents discover and route to the best price.</p>
          <span className="more">See the network →</span>
        </Link>
      </div>

      <h2>Not a server — an agent</h2>
      <p className="body">
        Your node <b>sets its own price</b> (surges when busy, discounts when idle) and <b>advertises itself</b> so other
        agents can find and hire it. The buyer is an agent that judges the price, streams the answer, and{" "}
        <b>taps stop</b> when satisfied. Software paying software, in USDC, on Arc — and unlike a pay-per-call proxy, the
        inference runs on <b>your own hardware</b>.{" "}
        <Link href="/network" style={{ color: "var(--meter)" }}>
          How Joule differs →
        </Link>
      </p>
    </>
  );
}
