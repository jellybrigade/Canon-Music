import { getDb } from "../db";

// Rolling window of recent log lines, kept for crash reports / feedback attachments.
// Buffering in memory + batching writes means normal logging never does per-line
// disk I/O: no perf impact on hot paths (audio, sync, etc.).
const MAX_LINES = 500;
const FLUSH_INTERVAL_MS = 3000;

interface LogEntry {
  ts: number;
  level: string;
  message: string;
}

const buffer: LogEntry[] = [];
let dirty = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function push(level: string, args: unknown[]): void {
  const message = args.map(formatLogValue).join(" ");
  buffer.push({ ts: Date.now(), level, message });
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  dirty = true;
}

// WebKit builds a stack out of frames alone, so logging `err.stack` on Linux drops the
// one line saying what went wrong and every entry reads as an anonymous bundle offset.
// V8 opens its stack with the message already, hence the prefix check.
export function formatLogValue(v: unknown): string {
  if (v instanceof Error) {
    const head = v.message ? `${v.name}: ${v.message}` : v.name;
    if (!v.stack) return head;
    return v.stack.startsWith(head) ? v.stack : `${head}\n${v.stack}`;
  }
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

async function flush(): Promise<void> {
  if (!dirty) return;
  const toWrite = buffer.slice();
  dirty = false;
  try {
    const db = await getDb();
    for (const entry of toWrite) {
      await db.execute(
        "INSERT INTO app_logs (ts, level, message) VALUES (?, ?, ?)",
        [entry.ts, entry.level, entry.message]
      );
    }
    buffer.splice(0, toWrite.length);
    await db.execute(
      "DELETE FROM app_logs WHERE id NOT IN (SELECT id FROM app_logs ORDER BY id DESC LIMIT ?)",
      [MAX_LINES]
    );
  } catch {
    // Logging must never itself throw / break the app.
  }
}

let initialized = false;

export function initLogger(): void {
  if (initialized) return;
  initialized = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args: unknown[]) => { push("log", args); original.log(...args); };
  console.info = (...args: unknown[]) => { push("info", args); original.info(...args); };
  console.warn = (...args: unknown[]) => { push("warn", args); original.warn(...args); };
  console.error = (...args: unknown[]) => { push("error", args); original.error(...args); };

  flushTimer = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
}

export const logger = {
  error(message: string): void {
    push("error", [message]);
  },
  flush,
  async getRecent(n: number = MAX_LINES): Promise<string> {
    await flush();
    try {
      const db = await getDb();
      const rows = await db.select<{ ts: number; level: string; message: string }[]>(
        "SELECT ts, level, message FROM app_logs ORDER BY id DESC LIMIT ?",
        [n]
      );
      return rows
        .reverse()
        .map((r) => `[${new Date(r.ts).toISOString()}] ${r.level.toUpperCase()} ${r.message}`)
        .join("\n");
    } catch {
      return "(logs unavailable)";
    }
  },
};

// Exposed for tests / HMR teardown; not used in normal app flow.
export function stopLogger(): void {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  initialized = false;
}
