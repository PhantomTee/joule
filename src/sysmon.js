// System monitor: CPU load + (optional) NVIDIA GPU stats.
// Original implementation: CPU via node:os; GPU by shelling out to `nvidia-smi`
// when present (no native bindings). Returns nulls gracefully when unavailable.

import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function cpuStats() {
  const cpus = os.cpus();
  // Aggregate non-idle fraction across cores as a rough utilization proxy.
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  const busyPct = total > 0 ? Math.round((1 - idle / total) * 100) : 0;
  return {
    cores: cpus.length,
    model: cpus[0]?.model ?? "unknown",
    loadAvg1: Number(os.loadavg()[0].toFixed(2)),
    freeMemMB: Math.round(os.freemem() / 1024 / 1024),
    totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
    approxBusyPct: busyPct,
  };
}

export async function gpuStats() {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [
        "--query-gpu=utilization.gpu,memory.used,memory.free,temperature.gpu,power.draw",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 4000 },
    );
    const line = stdout.trim().split("\n")[0];
    if (!line) return null;
    const [util, memUsed, memFree, temp, power] = line.split(",").map((s) => Number(s.trim()));
    return {
      present: true,
      vendor: "nvidia",
      utilPct: util,
      vramUsedMB: memUsed,
      vramFreeMB: memFree,
      tempC: temp,
      powerW: power,
    };
  } catch {
    // No NVIDIA GPU / driver, or AMD/Apple — report absent rather than failing.
    return { present: false };
  }
}

export async function snapshot() {
  const [gpu] = await Promise.all([gpuStats()]);
  return { cpu: cpuStats(), gpu, hostname: os.hostname(), platform: process.platform };
}
