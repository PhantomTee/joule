export default function Footer() {
  return (
    <footer>
      <div className="wrap" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, padding: 0 }}>
        <span>
          built on Circle x402 nanopayments · settles on{" "}
          <a href="https://docs.arc.io" target="_blank" rel="noreferrer">
            Arc
          </a>
        </span>
        <span>
          <a href="https://github.com/PhantomTee/joule">GitHub</a>
        </span>
      </div>
    </footer>
  );
}
