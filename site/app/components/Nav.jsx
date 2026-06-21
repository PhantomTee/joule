"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/", "Home"],
  ["/how-it-works", "How it works"],
  ["/operators", "Operators"],
  ["/agents", "Agents"],
  ["/network", "Network"],
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav>
      <div className="nav-in">
        <Link className="mark" href="/">
          JOULE
        </Link>
        <span className="links">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? "on" : undefined}>
              {label}
            </Link>
          ))}
        </span>
        <a className="dl" href="https://github.com/PhantomTee/joule/releases/latest">
          Download
        </a>
      </div>
    </nav>
  );
}
