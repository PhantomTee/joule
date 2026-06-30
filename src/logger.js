// Minimal structured JSON logger (pino-compatible format, no external deps).
// Writes newline-delimited JSON to stderr so stdout stays clean for piping.
// Set LOG_LEVEL=debug|info|warn|error|fatal (default: info).

import { hostname as getHostname } from "node:os";

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const levelMin = LEVELS[(process.env.LOG_LEVEL ?? "info").toLowerCase()] ?? LEVELS.info;
const _hostname = getHostname();
const _pid = process.pid;

function write(levelNum, levelName, msg, extra = {}) {
  if (levelNum < levelMin) return;
  const line = JSON.stringify({
    level: levelNum,
    time: Date.now(),
    pid: _pid,
    hostname: _hostname,
    msg,
    ...extra,
  });
  process.stderr.write(line + "\n");
}

function makeLogger(bindings = {}) {
  return {
    trace: (msg, x) => write(10, "trace", msg, { ...bindings, ...x }),
    debug: (msg, x) => write(20, "debug", msg, { ...bindings, ...x }),
    info:  (msg, x) => write(30, "info",  msg, { ...bindings, ...x }),
    warn:  (msg, x) => write(40, "warn",  msg, { ...bindings, ...x }),
    error: (msg, x) => write(50, "error", msg, { ...bindings, ...x }),
    fatal: (msg, x) => write(60, "fatal", msg, { ...bindings, ...x }),
    child: (b) => makeLogger({ ...bindings, ...b }),
  };
}

export const logger = makeLogger();
