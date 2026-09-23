/**
 * Coverage for `src/lib/transportHealth.ts`: the breaker that stops `apiPost` re-running
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
} from "./transportHealth";

const URL_ = "https://music.example";
const OTHER = "https://other.example";

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
  // The breaker's own mechanics are about a transport that really is down. A probe that
  // gets through excuses the stall instead, which has its own describe below.
  probeUnreachable();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("breaker", () => {
  it("stays quiet after a single timed-out ladder", async () => {
    expect(await noteTransportTimeout(URL_)).toBeNull();
    expect(transportStallNotice(URL_)).toBeNull();
  });

  it("opens on the second consecutive timed-out ladder", async () => {
    await noteTransportTimeout(URL_);
    const notice = await noteTransportTimeout(URL_);
    expect(notice).not.toBeNull();
    expect(transportStallNotice(URL_)).toBe(notice);
  });

  it("clears the count on any successful request", async () => {
    await noteTransportTimeout(URL_);
    recordTransportSuccess(URL_);
    expect(await noteTransportTimeout(URL_)).toBeNull();
    expect(transportStallNotice(URL_)).toBeNull();
  });

  it("stops blocking once the cooldown expires, so a healed network is retried", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    vi.advanceTimersByTime(14_999);
    expect(transportStallNotice(URL_)).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(transportStallNotice(URL_)).toBeNull();
  });

  it("re-opens on a single timeout once it has opened before", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    vi.advanceTimersByTime(15_001);
    expect(await noteTransportTimeout(URL_)).not.toBeNull();
    expect(transportStallNotice(URL_)).not.toBeNull();
  });

  it("lengthens the cooldown on each reopening instead of probing every 15s forever", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    vi.advanceTimersByTime(15_001);
    await noteTransportTimeout(URL_);
    vi.advanceTimersByTime(59_000);
    expect(transportStallNotice(URL_)).not.toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(transportStallNotice(URL_)).toBeNull();
  });

  it("closes again after a success that follows a reopening", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    recordTransportSuccess(URL_);
    expect(transportStallNotice(URL_)).toBeNull();
    expect(await noteTransportTimeout(URL_)).toBeNull();
  });
});

describe("diagnosis", () => {
  it("names the local HTTP layer when the native stack keeps reaching the server", async () => {
    probeReachable(120);
    await noteTransportTimeout(URL_);
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
    transportStallNotice(URL_);
    transportStallNotice(URL_);
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

describe("a burst of requests stalling together", () => {
  it("counts as the one opening they share, not one each", async () => {
    await noteTransportTimeout(URL_);
    await Promise.all([
      noteTransportTimeout(URL_),
      noteTransportTimeout(URL_),
      noteTransportTimeout(URL_),
      noteTransportTimeout(URL_),
    ]);

    expect(invokeCount("probe_server")).toBe(1);
    // Still on the first rung of the ladder: four re-openings would have put it on 300s.
    vi.advanceTimersByTime(15_001);
    expect(transportStallNotice(URL_)).toBeNull();
  });

  it("still answers every one of them with the notice", async () => {
    await noteTransportTimeout(URL_);
    const notices = await Promise.all([
      noteTransportTimeout(URL_),
      noteTransportTimeout(URL_),
    ]);

    expect(notices.every((n) => n !== null)).toBe(true);
  });
});

describe("per server", () => {
  it("keeps one server's stall from speaking for another", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);

    expect(transportStallNotice(URL_)).not.toBeNull();
    expect(transportStallNotice(OTHER)).toBeNull();
    expect(await noteTransportTimeout(OTHER)).toBeNull();
  });

  it("names the server the notice is about", async () => {
    await noteTransportTimeout(OTHER);
    await noteTransportTimeout(OTHER);

    expect(transportStallNotice(OTHER)).toContain(OTHER);
    expect(transportStallNotice(OTHER)).not.toContain(URL_);
  });

  it("clears only the server that got through", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(OTHER);
    await noteTransportTimeout(OTHER);

    recordTransportSuccess(OTHER);

    expect(transportStallNotice(OTHER)).toBeNull();
    expect(transportStallNotice(URL_)).not.toBeNull();
  });
});

describe("while the probe is still running", () => {
  /** A probe that answers only when the test says so, the way an 8s one behaves. */
  function heldProbe(): () => void {
    let release = (): void => {};
    onInvoke(
      "probe_server",
      () =>
        new Promise((resolve) => {
          release = () => resolve({ reachable: false, status: null, elapsedMs: 7, error: "connection refused" });
        })
    );
    return () => release();
  }

  it("fails fast on a plain stall message rather than letting requests through", async () => {
    const release = heldProbe();
    await noteTransportTimeout(URL_);
    const opening = noteTransportTimeout(URL_);

    const early = transportStallNotice(URL_);
    expect(early).not.toBeNull();
    expect(early).toContain("timing out");
    expect(early).not.toContain("connection refused");

    release();
    await opening;
    expect(transportStallNotice(URL_)).toContain("connection refused");
  });

  it("does not serve the previous opening's diagnosis", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    expect(transportStallNotice(URL_)).toContain("connection refused");

    vi.advanceTimersByTime(15_001);
    const release = heldProbe();
    const reopening = noteTransportTimeout(URL_);

    expect(transportStallNotice(URL_)).not.toContain("connection refused");

    release();
    await reopening;
  });
});

describe("describeStall on a reply that is not Navidrome", () => {
  it("does not call the server up when the direct check got a 404", () => {
    const msg = describeStall(URL_, { reachable: true, status: 404, elapsedMs: 40, error: null });
    expect(msg).toContain("404");
    expect(msg).not.toContain("the server is up");
    expect(msg).not.toContain("Network Proxy");
  });

  it("points at the address and its proxy when a gateway answers 502", () => {
    const msg = describeStall(URL_, { reachable: true, status: 502, elapsedMs: 40, error: null });
    expect(msg).toContain("502");
    expect(msg).toContain("server URL");
  });

  it("stays vague when the reply carried no status at all", () => {
    const msg = describeStall(URL_, { reachable: true, status: null, elapsedMs: 40, error: null });
    expect(msg).toContain("unexpected reply");
    expect(msg).not.toContain("the server is up");
  });

  it("still blames the local HTTP stack on a 204, which is a real answer", () => {
    const msg = describeStall(URL_, { reachable: true, status: 204, elapsedMs: 40, error: null });
    expect(msg).toContain("Network Proxy");
  });
});

describe("a stall the native stack disproves", () => {
  beforeEach(() => {
    probeReachable(94);
  });

  it("does not open, since the server and the network just answered", async () => {
    await noteTransportTimeout(URL_);
    const cause = await noteTransportTimeout(URL_);

    expect(transportStallNotice(URL_)).toBeNull();
    expect(cause).toContain("94ms");
    // One lost request is not this desktop's proxy, and saying so is the wrong advice.
    expect(cause).not.toContain("proxy");
  });

  it("opens on the next timeout when nothing got through since", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    const notice = await noteTransportTimeout(URL_);

    // Rust keeps reaching a server the webview keeps timing out on: the PAC-resolver stall
    // the breaker exists for, where letting every request through costs 37s each.
    expect(transportStallNotice(URL_)).not.toBeNull();
    expect(notice).toContain("proxy");
  });

  it("needs a full second streak once a request has got through", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    recordTransportSuccess(URL_);

    expect(await noteTransportTimeout(URL_)).toBeNull();
    expect(transportStallNotice(URL_)).toBeNull();
  });

  it("leaves the cooldown on its first rung", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);

    vi.advanceTimersByTime(15_001);
    expect(transportStallNotice(URL_)).toBeNull();
  });

  it("probes once for the excuse and once for the opening", async () => {
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);
    await noteTransportTimeout(URL_);

    expect(invokeCount("probe_server")).toBe(2);
  });

  it("lifts the breaker when the answer lands after the caller stopped waiting", async () => {
    let release = (): void => {};
    onInvoke(
      "probe_server",
      () =>
        new Promise((resolve) => {
          release = () => resolve({ reachable: true, status: 200, elapsedMs: 7900, error: null });
        })
    );
    await noteTransportTimeout(URL_);
    const opening = noteTransportTimeout(URL_);
    await vi.advanceTimersByTimeAsync(3_000);
    await opening;
    expect(transportStallNotice(URL_)).not.toBeNull();

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(transportStallNotice(URL_)).toBeNull();
  });
});
