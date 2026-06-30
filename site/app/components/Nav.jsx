"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  ["/how-it-works", "How it works"],
  ["/marketplace", "Marketplace"],
  ["/operators", "Operators"],
  ["/agents", "Agents"],
  ["/network", "Network"],
];

function Logo() {
  return (
    <Link className="logo" href="/" aria-label="Joule home">
      <span className="dot">
        <i />
      </span>
      Joule
    </Link>
  );
}

export default function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const overlay = path === "/";

  return (
    <>
      <nav className={overlay ? "ov" : undefined}>
        <div className="nav-in">
          <Logo />
          <span className="navlinks">
            {links.map(([href, label]) => (
              <Link key={href} href={href} className={path === href ? "on" : undefined}>
                {label}
              </Link>
            ))}
          </span>
          <button className="burger" aria-label="Open menu" onClick={() => setOpen(true)}>
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>

      {open && (
        <div className="sheet" role="dialog" aria-modal="true">
          <div className="top">
            <Logo />
            <button className="close" aria-label="Close menu" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <div className="ml">
            {links.map(([href, label]) => (
              <Link key={href} href={href} onClick={() => setOpen(false)}>
                {label}
              </Link>
            ))}
          </div>
          <a className="cta-b" href="https://github.com/PhantomTee/joule/releases/latest">
            Download the node ↗
          </a>
        </div>
      )}
    </>
  );
}
