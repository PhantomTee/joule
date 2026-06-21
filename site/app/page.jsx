import Link from "next/link";

const VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260517_222138_3e3205be-3364-417b-a64a-bfe087acbec4.mp4";

const stats = [
  { mark: "$", num: "0.0002", lab: "USDC\nper second" },
  { num: "0", lab: "accounts\nor keys" },
  { num: "1", lab: "file\nto run" },
];

export default function Home() {
  return (
    <>
    <section className="stage">
      <video className="bgvideo" src={VIDEO} autoPlay loop muted playsInline aria-hidden="true" />
      <div className="scrim" />

      <div className="stage-in">
        <div className="stats">
          <div className="grid">
            {stats.map((s, i) => (
              <div className={`stat fadeUp d${i + 2}`} key={s.lab}>
                <div className="num">
                  {s.mark && <i>{s.mark}</i>}
                  {s.num}
                </div>
                <div className="lab">{s.lab}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bottom">
          <div className="rowA">
            <p className="tagline fadeUp d5">Sell your spare seconds to autonomous agents</p>
            <a className="cta-link fadeUp d6" href="https://github.com/PhantomTee/joule/releases/latest">
              Download the node ↗
            </a>
          </div>

          <div className="rowB">
            <p className="descr fadeUp d7">An idle GPU or CPU, metered by the second and paid in USDC on Arc.</p>
            <h1 className="headline" aria-label="Sell spare seconds">
              <span className="clip" aria-hidden="true">
                <span className="w reveal r0">Sell</span>
              </span>
              <span className="clip" aria-hidden="true">
                <span className="w reveal r1">Spare</span>
              </span>
              <span className="clip" aria-hidden="true">
                <span className="w reveal r2">Seconds</span>
              </span>
            </h1>
          </div>
        </div>
      </div>
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
      Your node <b>sets its own price</b> (it surges when busy, discounts when idle) and <b>advertises itself</b> so
      other agents can find and hire it. The buyer is an agent too: it judges the price against its budget, streams the
      answer, and <b>taps stop</b> when satisfied. Software paying software, in USDC, on Arc — and unlike a pay-per-call
      proxy, the inference runs on <b>your own hardware</b>.
    </p>

    <h2>Try it free — no wallet</h2>
    <p className="body">Every node serves a capped demo so you can feel the stream before paying a cent:</p>
    <pre>
      <code>
        <span className="cmt"># against any running node</span>
        {`
curl -N http://localhost:8080/v1/demo \\
  -H 'content-type: application/json' \\
  -d '{"prompt":"explain x402 in one line"}'`}
      </code>
    </pre>

    <div className="cta">
      <a className="btn" href="https://github.com/PhantomTee/joule/releases/latest">
        Download the node
      </a>
      <Link className="ghost" href="/how-it-works">
        How it works
      </Link>
    </div>
    </>
  );
}
