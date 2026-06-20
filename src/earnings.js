// Append-only USDC earnings ledger (JSONL). Dependency-free and crash-safe:
// each settled session is one appended line. Aggregates are computed on read.

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { config, atomicToUsdc } from "./config.js";

export class Earnings {
  constructor(file = config.earningsFile) {
    this.file = file;
  }

  async record(entry) {
    const row = {
      ts: new Date().toISOString(),
      sessionId: entry.sessionId,
      model: entry.model,
      payer: entry.payer ?? "unknown",
      seconds: entry.seconds ?? 0,
      outputTokens: entry.outputTokens ?? 0,
      amountAtomic: entry.amountAtomic ?? 0,
      amountUsdc: atomicToUsdc(entry.amountAtomic ?? 0),
      gatewayTx: entry.gatewayTx ?? null,
      network: config.arc.network,
    };
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify(row) + "\n", "utf8");
    return row;
  }

  async all() {
    let text;
    try {
      text = await readFile(this.file, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  async summary() {
    const rows = await this.all();
    const totalAtomic = rows.reduce((s, r) => s + (r.amountAtomic || 0), 0);
    const totalSeconds = rows.reduce((s, r) => s + (r.seconds || 0), 0);
    return {
      jobs: rows.length,
      totalUsdc: atomicToUsdc(totalAtomic),
      totalSeconds: Number(totalSeconds.toFixed(2)),
      lastJobs: rows.slice(-10).reverse(),
    };
  }
}
