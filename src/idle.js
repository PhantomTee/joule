// Idle detection: seconds since the last user input (keyboard/mouse).
// Windows: query GetLastInputInfo via a short PowerShell snippet (no native addon).
// Other platforms: best-effort stub returning a large value (treated as idle).

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PS_LAST_INPUT = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class IdleApi {
  [StructLayout(LayoutKind.Sequential)]
  struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("kernel32.dll")] static extern uint GetTickCount();
  public static uint IdleMillis() {
    LASTINPUTINFO lii = new LASTINPUTINFO();
    lii.cbSize = (uint)Marshal.SizeOf(lii);
    GetLastInputInfo(ref lii);
    return GetTickCount() - lii.dwTime;
  }
}
'@
[IdleApi]::IdleMillis()
`;

export async function idleSeconds() {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", PS_LAST_INPUT],
        { timeout: 5000 },
      );
      const ms = Number(stdout.trim());
      if (Number.isFinite(ms)) return Math.round(ms / 1000);
    } catch {
      /* fall through to stub */
    }
  }
  // Unknown platform / failure: assume idle so the provider stays usable in demos.
  return Number.MAX_SAFE_INTEGER;
}

// Polls idle time and exposes the latest reading without blocking callers.
export class IdleMonitor {
  constructor(intervalMs = 5000) {
    this.intervalMs = intervalMs;
    // Start at 0 (treat as active) so pricing doesn't apply the idle discount
    // before the first real reading lands.
    this.lastSeconds = 0;
    this.timer = null;
  }

  start() {
    const tick = async () => {
      this.lastSeconds = await idleSeconds();
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  get seconds() {
    return this.lastSeconds;
  }
}
