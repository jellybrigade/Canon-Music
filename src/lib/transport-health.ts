import { invoke } from "@tauri-apps/api/core";
import { cappedSet } from "./boundedCache";

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

/** How long the failing request waits for the probe to name a cause before giving up on
 *  it. The probe's own budget is 8s and the caller has already spent a full ladder, so
 *  the rest of the answer arrives in the background and upgrades the notice in place. */
const DIAGNOSIS_WAIT_MS = 3_000;

/** Health is per server, and servers are added by hand, so this is a guard against an
 *  unbounded caller rather than a working limit. Oldest entry goes first. */
const MAX_TRACKED_SERVERS = 16;

interface ServerHealth {
  consecutiveTimeouts: number;
  openUntil: number;
  openings: number;
  diagnosis: string | null;
}

const health = new Map<string, ServerHealth>();

function healthFor(baseUrl: string): ServerHealth {
  const existing = health.get(baseUrl);
  if (existing) return existing;
  const fresh: ServerHealth = {
    consecutiveTimeouts: 0,
    openUntil: 0,
    openings: 0,
    diagnosis: null,
  };
  cappedSet(health, baseUrl, fresh, MAX_TRACKED_SERVERS);
  return fresh;
}

export function resetTransportHealth(): void {
  health.clear();
}

export function recordTransportSuccess(baseUrl: string): void {
  health.delete(baseUrl);
}

function stalling(baseUrl: string): string {
  return `Requests to ${baseUrl} are timing out`;
}

/** The message to fail fast with, or null while requests are still worth attempting.
 *  Open with no diagnosis yet still fails fast: the probe is an upgrade to the message,
 *  not the thing that decides whether the transport is worth another 37s. */
export function transportStallNotice(baseUrl: string): string | null {
  const state = health.get(baseUrl);
  if (!state || Date.now() >= state.openUntil) return null;
  return state.diagnosis ?? `${stalling(baseUrl)}.`;
}

/** Records one request that spent its whole attempt ladder on timeouts. Returns the
 *  notice once the breaker is open, so the caller can put a cause in front of the user
 *  instead of a bare millisecond count. */
export async function noteTransportTimeout(baseUrl: string): Promise<string | null> {
  const state = healthFor(baseUrl);
  // A stalled transport fails every in-flight request together, so all of them land here
  // for the one opening they share. Counting those as fresh evidence would walk the
  // cooldown ladder to its top in one burst and spend one probe per failed request.
  if (Date.now() < state.openUntil) return transportStallNotice(baseUrl);

  state.consecutiveTimeouts += 1;
  const threshold = state.openings === 0 ? TRIP_AFTER_TIMEOUTS : 1;
  if (state.consecutiveTimeouts < threshold) return null;

  const cooldown =
    COOLDOWN_LADDER_MS[Math.min(state.openings, COOLDOWN_LADDER_MS.length - 1)]!;
  state.consecutiveTimeouts = 0;
  state.openings += 1;
  state.openUntil = Date.now() + cooldown;
  // The previous opening's diagnosis describes the network as it was then, which is the
  // one thing this opening cannot vouch for.
  state.diagnosis = null;

  const opening = state.openings;
  const probing = probeNativeStack(baseUrl).then((probe) => {
    if (state.openings === opening) state.diagnosis = describeStall(baseUrl, probe);
  });
  await withinBudget(probing);
  return transportStallNotice(baseUrl);
}

function withinBudget(work: Promise<void>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, DIAGNOSIS_WAIT_MS);
  });
  return Promise.race([work, budget]).finally(() => clearTimeout(timer));
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
  const prefix = stalling(baseUrl);
  if (!probe) {
    return `${prefix}, and the reachability check could not run.`;
  }
  if (probe.reachable) {
    const ms = Math.round(probe.elapsedMs);
    // Anything that answers at all sets `reachable`, so a 404 from a wrong URL, a 502
    // from a proxy in front of a dead server and a 407 from an intercepting proxy would
    // all read as "the server is up" if the status were not asked about.
    if (probe.status !== null && probe.status >= 200 && probe.status < 300) {
      return (
        `${prefix}, but Canon's own network layer reached it in ${ms}ms, so the server is up. ` +
        "This machine's web HTTP stack is stalling: on Linux that is usually the desktop " +
        "proxy set to Automatic with no working PAC file, or a dead DNS server. Check the " +
        "system Network Proxy setting."
      );
    }
    const answer = probe.status === null ? "an unexpected reply" : `HTTP ${probe.status}`;
    return (
      `${prefix}, and a direct check of that address answered ${answer} rather than ` +
      "Navidrome. Check the server URL, and anything proxying it."
    );
  }
  const reason = probe.error ?? `no response in ${Math.round(probe.elapsedMs)}ms`;
  return `${prefix}, and Canon cannot reach it directly either (${reason}). The server or the connection is down.`;
}
