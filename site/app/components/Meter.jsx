"use client";
import { useEffect, useState } from "react";

export default function Meter() {
  const [earned, setEarned] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion:reduce)").matches) return;
    const t = setInterval(() => setEarned((e) => e + 0.0002 + Math.random() * 0.0001), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="meterbox">
      <div className="lab">a node earning right now</div>
      <div className="val">
        {earned.toFixed(6)}
        <small>USDC</small>
      </div>
      <div className="rate">+0.0002 USDC / second while serving</div>
    </div>
  );
}
