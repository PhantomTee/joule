"use client";
import { useEffect, useRef } from "react";

// Reliable muted-autoplay background video: some browsers won't start an
// autoplaying <video> until JS nudges play() once it can play.
export default function BgVideo({ src }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    const kick = () => v.play().catch(() => {});
    kick();
    v.addEventListener("canplay", kick, { once: true });
    v.addEventListener("loadeddata", kick, { once: true });
    return () => {
      v.removeEventListener("canplay", kick);
      v.removeEventListener("loadeddata", kick);
    };
  }, []);
  return (
    <video ref={ref} className="bgvideo" src={src} autoPlay loop muted playsInline preload="auto" aria-hidden="true" />
  );
}
