import Link from "next/link";

export const metadata = { title: "Joule · agents" };

export default function Agents() {
  return (
    <>
      <section className="hero">
        <div className="eyebrow">for builders &amp; agents</div>
        <h1>
          Money is the <span className="g">API key</span>.
        </h1>
        <p className="sub">
          No signup, no dashboard, no key rotation. Your agent funds a Circle Gateway balance and pays per second of
          inference. It discovers a node, judges the price against its budget, streams, and stops on its own.
        </p>
      </section>

      <h2>Try it — no wallet</h2>
      <p className="body">Every node serves a free, capped demo so you can feel the stream before paying a cent:</p>
      <pre>
        <code>
          <span className="cmt"># against any running node</span>
          {`
curl -N http://localhost:8080/v1/demo \\
  -H 'content-type: application/json' \\
  -d '{"prompt":"explain x402 in one line"}'`}
        </code>
      </pre>

      <h2>Pay per second</h2>
      <p className="body">
        For real usage the endpoint is x402-gated: the first call returns <code>402</code> with the price, your client
        signs a USDC tick, and tokens stream — one paid pull per second. Stop pulling and you stop paying.
      </p>
      <pre>
        <code>
          <span className="cmt"># the reasoning buyer agent: discover → judge price → stream → stop</span>
          {`
PROVIDERS=http://localhost:8080 \\
npm run agent -- --goal "summarize this contract" --budget 0.005

`}
          <span className="cmt"># it walks away if price &gt; budget, else streams and judges</span>
          {`
`}
          <span className="cmt"># each second, stopping when the answer is good enough.</span>
        </code>
      </pre>

      <h2>Why an agent, not just an SDK call</h2>
      <p className="body">
        The buyer isn&apos;t a dumb HTTP client. It <b>discovers</b> providers via their agent-card, <b>compares</b>{" "}
        price to its max, <b>streams</b> the answer, and <b>evaluates</b> the result itself — stopping the moment
        it&apos;s satisfied or the budget runs out. It narrates every decision, so you can watch it reason about spend in
        real time.
      </p>

      <h2>Bring your own model</h2>
      <p className="body">
        The inference backend is pluggable via <code>INFERENCE_BASE</code> — Joule ships a small local model so a node
        works out of the box, but a provider can point it at any OpenAI-compatible endpoint they run. The payment,
        metering, and discovery layer stays the same.
      </p>

      <div className="cta" style={{ marginTop: 34 }}>
        <a className="btn" href="https://github.com/PhantomTee/joule">
          Read the docs →
        </a>
        <Link className="ghost" href="/network">
          Find nodes →
        </Link>
      </div>
    </>
  );
}
