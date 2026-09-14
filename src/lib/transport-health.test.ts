/**
 * Coverage for `src/lib/transport-health.ts`: the breaker that stops `apiPost` re-running
 * a 12s ladder against a transport that is stalling every request, and the native-stack
 * probe that tells "the server is down" apart from "this machine's HTTP layer is broken".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);

import { onInvoke, resetTauriMocks } from "../test/mocks/tauri";
import { invokeCount } from "../test/perf";
import {
  describeStall,
  noteTransportTimeout,
  recordTransportSuccess,
  resetTransportHealth,
  transportStallNotice,
} from "./transport-health";

const URL_ = "https://music.example";

/** The Rust probe answering "I reached it fine", which is the interesting case. */
function probeReachable(ms = 120): void {
  onInvoke("probe_server", () => ({ reachable: true, status: 200, elapsedMs: ms, error: null }));
}

function probeUnreachable(error = "connection refused"): void {
  onInvoke("probe_server", () => ({ reachable: false, status: null, elapsedMs: 5000, error }));
}

beforeEach(() => {
  vi.useFakeTimers();
  resetTauriMocks();
  resetTransportHealth();
  probeReachable();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("breaker", () => {
  it("stays quiet after a single timed-out ladder", async () => {
    expect(await noteTransportTimeout(URL_)).toBeNull();
    expect(transportStallNotice()).toBeNull();
  });

  it("opens on the second consecutive timed-out ladder", async () => {
    await noteTransportTimeout(URL_);
    const notice = await noteTransportTimeout(URL_);
    expect(notice).not.toBeNull();
    expect(transportStallNotice()).toBe(notice);
  });

  it("clears the count on any successful request", async () => {
    await noteTransportTimeout(URL_);
    recordTransportSuccess();
    expect(await noteTransportTimeout(URL_)).toBeNull();
    expect(transportStallNotice()).toBeNull();
  });

  it("stops blocking once the cooldown expires, so a healed network is retried", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    vi.advanceTimersByTime(14_999);
    expect(transportStallNotice()).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(transportStallNotice()).toBeNull();
  });

  it("re-opens on a single timeout once it has opened before", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    vi.advanceTimersByTime(15_001);
    expect(await noteTransportTimeout(URL_)).not.toBeNull();
    expect(transportStallNotice()).not.toBeNull();
  });

  it("lengthens the cooldown on each reopening instead of probing every 15s forever", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    vi.advanceTimersByTime(15_001);
    await noteTransportTimeout(URL_);
    vi.advanceTimersByTime(59_000);
    expect(transportStallNotice()).not.toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(transportStallNotice()).toBeNull();
  });

  it("closes again after a success that follows a reopening", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    recordTransportSuccess();
    expect(transportStallNotice()).toBeNull();
    expect(await noteTransportTimeout(URL_)).toBeNull();
  });
});

describe("diagnosis", () => {
  it("names the local HTTP layer when the native stack reaches the server", async () => {
    probeReachable(120);
    await noteTransportTimeout(URL_);
    const notice = await noteTransportTimeout(URL_);
    expect(notice).toContain("120ms");
    expect(notice).toContain("proxy");
    expect(notice).not.toContain("unreachable");
  });

  it("blames the server when the native stack cannot reach it either", async () => {
    probeUnreachable("connection refused");
    await noteTransportTimeout(URL_);
    const notice = await noteTransportTimeout(URL_);
    expect(notice).toContain("connection refused");
    expect(notice).not.toContain("proxy");
  });

  it("still reports the stall when the probe itself fails", async () => {
    onInvoke("probe_server", () => {
      throw new Error("command not found");
    });
    await noteTransportTimeout(URL_);
    const notice = await noteTransportTimeout(URL_);
    expect(notice).not.toBeNull();
    expect(notice).toContain("timing out");
  });

  it("probes the native stack exactly once per opening", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    transportStallNotice();
    transportStallNotice();
    expect(invokeCount("probe_server")).toBe(1);
  });

  it("probes again on the next opening, since the network may have changed", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    vi.advanceTimersByTime(15_001);
    await noteTransportTimeout(URL_);
    expect(invokeCount("probe_server")).toBe(2);
  });

  it("hands the probe the server URL it is failing against", async () => {
    const seen: unknown[] = [];
    onInvoke("probe_server", (args) => {
      seen.push(args);
      return { reachable: true, status: 200, elapsedMs: 5, error: null };
    });
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    expect(seen).toEqual([{ url: URL_ }]);
  });
});

describe("describeStall", () => {
  it("reports an unknown reachability when there is no probe result", () => {
    const msg = describeStall(URL_, null);
    expect(msg).toContain("timing out");
    expect(msg).toContain(URL_);
  });

  it("rounds a fractional probe time rather than printing it raw", () => {
    const msg = describeStall(URL_, { reachable: true, status: 200, elapsedMs: 12.7, error: null });
    expect(msg).toContain("13ms");
    expect(msg).not.toContain("12.7");
  });

  it("falls back to a named failure when the probe carries no error text", () => {
    const msg = describeStall(URL_, { reachable: false, status: null, elapsedMs: 5000, error: null });
    expect(msg).toContain(URL_);
    expect(msg.length).toBeGreaterThan(20);
  });
});
