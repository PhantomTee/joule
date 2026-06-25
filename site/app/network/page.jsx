import Link from "next/link";
import LiveNetwork from "./LiveNetwork";

export const metadata = { title: "Joule · network" };

const rows = [
  ["Hosted APIs", ["no", "no"], ["no", "per-token billing"], ["no", "no"], ["no", "card / account"]],
  ["InferPay", ["no", "hosted"], ["no", "per-call"], ["no", "no"], ["yes", "yes"]],
  ["darkbloom", ["yes", "yes"], ["no", "per-job"], ["no", "partial"], ["yes", "yes"]],
  ["wavefy", ["yes", "yes"], ["no", "per-call"], ["no", "no"], ["yes", "yes"]],
];

export default function Network() {
  return (
    <>
      <section className="hero">
        <div className="eyebrow">the network</div>
        <h1>
          A network of nodes, <span className="g">not one server</span>.
        </h1>
        <p className="sub">
          Nodes don&apos;t need a public IP or port-forwarding. Each one registers <b>outbound</b> with a lightweight
          coordinator and heartbeats its live price and load. Buyer agents read the directory and route to whoever fits
          their budget.
        </p>
      </section>

      <div className="flow">
        <div className="node">
          <div className="t">Nodes register</div>
          <div className="d">outbound heartbeat with live price + load</div>
        </div>
        <div className="arrow">→</div>
        <div className="node">
          <div className="t">Coordinator</div>
          <div className="d">a directory of who&apos;s online and how much</div>
        </div>
        <div className="arrow">→</div>
        <div className="node">
          <div className="t">Agents route</div>
          <div className="d">discover, compare price, pay the best fit</div>
        </div>
      </div>

      <LiveNetwork />

      <h2 style={{ marginTop: 46 }}>Already live — join with zero setup</h2>
      <p className="body">
        Every node joins{" "}
        <a href="https://joule-coordinator.onrender.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
          the shared Joule network
        </a>{" "}
        automatically — nobody runs or hosts a coordinator just to be discoverable. Download the node, run it, and it
        announces itself outbound. Want a private network instead? Run your own and point your nodes at it:
      </p>
      <pre>
        <code>
          <span className="cmt"># optional: your own private directory instead of the shared one</span>
          {`
npm run coordinator                 `}
          <span className="cmt"># dashboard on :19150</span>
          {`

`}
          <span className="cmt"># point a node at it (or "off" to run solo, no network)</span>
          {`
COORDINATOR_URL=http://host:19150 ./joule-node.exe`}
        </code>
      </pre>

      <h2>How Joule differs</h2>
      <p className="body">
        Plenty of projects sell inference. The combination Joule puts together is the point: real idle <b>local</b>{" "}
        compute, true per-second metering with tap-to-stop, autonomous buyer + pricing agents, and Circle/x402 settlement
        on Arc.
      </p>
      <table>
        <tbody>
          <tr>
            <th>&nbsp;</th>
            <th>Idle local compute</th>
            <th>Per-second + tap-to-stop</th>
            <th>Autonomous agents</th>
            <th>Crypto-native pay</th>
          </tr>
          {rows.map((r) => (
            <tr key={r[0]}>
              <td className="f">{r[0]}</td>
              {r.slice(1).map((c, i) => (
                <td key={i} className={c[0]}>
                  {c[1]}
                </td>
              ))}
            </tr>
          ))}
          <tr className="me">
            <td className="f">Joule</td>
            <td className="yes">yes</td>
            <td className="yes">yes</td>
            <td className="yes">yes</td>
            <td className="yes">x402 · USDC · Arc</td>
          </tr>
        </tbody>
      </table>

      <div className="cta" style={{ marginTop: 34 }}>
        <Link className="btn" href="/operators">
          Join the network →
        </Link>
        <Link className="ghost" href="/agents">
          Build on it →
        </Link>
      </div>
    </>
  );
}
