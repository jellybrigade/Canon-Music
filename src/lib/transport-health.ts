import { invoke } from "@tauri-apps/api/core";

export interface ServerProbe {
  reachable: boolean;
  status: number | null;
  elapsedMs: number;
  error: string | null;
}

/** A resolver hiccup can legitimately burn one ladder, so one is not evidence. Two in a
 *  row is: a stalling transport fails identically every time, and by then the user has
 *  already waited ~75s. Once it has opened, one more timeout is enough to reopen. */
const TRIP_AFTER_TIMEOUTS = 2;

/** Each reopening waits longer, so a network that stays broken costs one probe request
 *  every few minutes rather than one every quarter minute. Never permanent: a transport
 *  stall is exactly the self-healing kind of failure, so the last rung still retries. */
const COOLDOWN_LADDER_MS = [15_000, 60_000, 300_000];

let consecutiveTimeouts = 0;
let openUntil = 0;
let openings = 0;
let diagnosis: string | null = null;

export function resetTransportHealth(): void {
  consecutiveTimeouts = 0;
  openUntil = 0;
  openings = 0;
  diagnosis = null;
}

export function recordTransportSuccess(): void {
  if (consecutiveTimeouts === 0 && openings === 0) return;
  resetTransportHealth();
}

/** The message to fail fast with, or null while requests are still worth attempting. */
export function transportStallNotice(): string | null {
  if (Date.now() >= openUntil) return null;
  return diagnosis;
}

/** Records one request that spent its whole attempt ladder on timeouts. Returns the
 *  diagnosis if this was the timeout that opened the breaker, so the caller can put a
 *  cause in front of the user instead of a bare millisecond count. */
export async function noteTransportTimeout(baseUrl: string): Promise<string | null> {
  consecutiveTimeouts += 1;
  const threshold = openings === 0 ? TRIP_AFTER_TIMEOUTS : 1;
  if (consecutiveTimeouts < threshold) return null;

  const cooldown = COOLDOWN_LADDER_MS[Math.min(openings, COOLDOWN_LADDER_MS.length - 1)]!;
  consecutiveTimeouts = 0;
  openings += 1;
  openUntil = Date.now() + cooldown;
  diagnosis = describeStall(baseUrl, await probeNativeStack(baseUrl));
  return diagnosis;
}

/** The whole point of the probe: Rust's HTTP client shares the machine's network but not
 *  the webview's proxy resolver, so "Rust got through, the webview did not" localises the
 *  fault to this desktop's HTTP configuration rather than to the server. */
async function probeNativeStack(baseUrl: string): Promise<ServerProbe | null> {
  try {
    return (await invoke("probe_server", { url: baseUrl })) as ServerProbe;
  } catch {
    return null;
  }
}

export function describeStall(baseUrl: string, probe: ServerProbe | null): string {
  const stalling = `Requests to ${baseUrl} are timing out`;
  if (!probe) {
    return `${stalling}, and the reachability check could not run.`;
  }
  if (probe.reachable) {
    const ms = Math.round(probe.elapsedMs);
    return (
      `${stalling}, but Canon's own network layer reached it in ${ms}ms, so the server is up. ` +
      "This machine's web HTTP stack is stalling: on Linux that is usually the desktop " +
      "proxy set to Automatic with no working PAC file, or a dead DNS server. Check the " +
      "system Network Proxy setting."
    );
  }
  const reason = probe.error ?? `no response in ${Math.round(probe.elapsedMs)}ms`;
  return `${stalling}, and Canon cannot reach it directly either (${reason}). The server or the connection is down.`;
}
