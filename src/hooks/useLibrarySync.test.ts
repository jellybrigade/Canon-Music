// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/sync", () => ({ syncLibrary: vi.fn() }));
vi.mock("./useGenreTree", () => ({ invalidateGenreTreeCache: vi.fn() }));
vi.mock("./useSetting", () => ({ useSetting: vi.fn(() => [intervalSetting, vi.fn(), true]) }));

import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { syncLibrary } from "../lib/sync";
import type { SyncProgress } from "../lib/sync";
import type { Server } from "../types/server";
import { useLibrarySync } from "./useLibrarySync";

/** Read by the mocked `useSetting` above; assign before rendering. */
let intervalSetting = "5";

type SyncResult = Awaited<ReturnType<typeof syncLibrary>>;
/** Every field optional, `changed` included, so a test names only the flags it cares about. */
type PartialSyncResult = Partial<Omit<SyncResult, "changed">> & { changed?: Partial<SyncResult["changed"]> };

const CLEAN: SyncResult = {
  failedAlbums: 0,
  failedPlaylists: 0,
  skippedAlbums: 0,
  prunedAlbums: 0,
  prunedTracks: 0,
  albumTracksIncomplete: false,
  skippedStages: [],
  changed: { albums: false, tracks: false, artists: false, loved: false, playlists: false },
};

function makeServer(id: string): Server {
  return {
    id,
    type: "navidrome",
    url: `https://${id}.example`,
    alt_url: null,
    display_name: id.toUpperCase(),
    username: "u",
    created_at: "2026-01-01",
  };
}

const SRV_A = makeServer("a");
const SRV_B = makeServer("b");

/**
 * One in-flight `syncLibrary` call: the server it was handed, the progress callback it was
 * handed, and manual settle controls. The hook's guard, its `serverRef` settle handler and
 * its interval are all only observable while a run is deliberately held open, so every test
 * here drives the boundary through these rather than through an auto-resolving mock.
 */
interface Run {
  server: Server;
  emitProgress: (p: SyncProgress) => void;
  resolve: (r?: PartialSyncResult) => void;
  reject: (e: unknown) => void;
}

let runs: Run[] = [];

function armSyncLibrary() {
  vi.mocked(syncLibrary).mockImplementation((server, onAlbumBatch) => {
    return new Promise<SyncResult>((res, rej) => {
      runs.push({
        server,
        emitProgress: (p) => onAlbumBatch?.(p),
        resolve: (r) => res({ ...CLEAN, ...r, changed: { ...CLEAN.changed, ...r?.changed } }),
        reject: rej,
      });
    });
  });
}

/** Flushes the promise chain plus any timers due within `ms`. */
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** How long `settle`/`failRun` advance the clock to drain the staggered fan-out. */
const FANOUT_MS = 1000;

function openRun(index: number): Run {
  const run = runs[index];
  if (!run) throw new Error(`expected a syncLibrary run at index ${index}, saw ${runs.length}`);
  return run;
}

/** Settles a run and drains its staggered 0/300/600/1000ms fan-out. */
async function settle(index: number, r?: PartialSyncResult) {
  openRun(index).resolve(r);
  await tick(FANOUT_MS);
}

async function failRun(index: number, e: unknown) {
  openRun(index).reject(e);
  await tick(FANOUT_MS);
}

function renderSync(server: Server | undefined, client = new QueryClient()) {
  return renderHook(({ server }: { server: Server | undefined }) => useLibrarySync(server, client), {
    initialProps: { server },
  });
}

/** Server ids in call order, which is what every switching test actually asserts on. */
function calledServerIds(): string[] {
  return vi.mocked(syncLibrary).mock.calls.map((c) => c[0].id);
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  runs = [];
  intervalSetting = "5";
  armSyncLibrary();
  vi.useFakeTimers();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  consoleError.mockRestore();
});

const MINUTE = 60 * 1000;

describe("useLibrarySync in-flight guard", () => {
  it("refuses a manual run while one is already in flight", async () => {
    const { result } = renderSync(SRV_A);
    await tick();
    expect(syncLibrary).toHaveBeenCalledTimes(1);

    let returns: boolean[] = [];
    act(() => {
      returns = [result.current.runSync(SRV_A), result.current.runSync(SRV_A), result.current.runSync(SRV_A)];
    });

    expect(returns).toEqual([false, false, false]);
    expect(syncLibrary).toHaveBeenCalledTimes(1);
    expect(result.current.syncStatus).toBe("syncing");
  });

  it("reports true for a run it starts and false for one it refuses", async () => {
    const { result } = renderSync(undefined);
    await tick();

    let first = false;
    let second = false;
    act(() => {
      first = result.current.runSync(SRV_A);
    });
    act(() => {
      second = result.current.runSync(SRV_A);
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("swallows every interval tick that lands during a run, then syncs on the next one", async () => {
    renderSync(SRV_A);
    await tick();

    // Three 5-minute ticks pass while the first sync is still downloading.
    await tick(15 * MINUTE);
    expect(syncLibrary).toHaveBeenCalledTimes(1);

    await settle(0);
    await tick(5 * MINUTE);
    expect(syncLibrary).toHaveBeenCalledTimes(2);
  });
});

describe("useLibrarySync server claim", () => {
  it("leaves the server unclaimed when the run it attempted was refused", async () => {
    const { result, rerender } = renderSync(undefined);
    await tick();

    // Manual run holds the guard, so the effect's syncIfNeeded is refused and must not stamp.
    act(() => {
      result.current.runSync(SRV_A);
    });
    rerender({ server: SRV_A });
    await tick();
    expect(syncLibrary).toHaveBeenCalledTimes(1);

    await settle(0);
    expect(calledServerIds()).toEqual(["a", "a"]);
  });

  it("does not re-sync a server already claimed by a completed run", async () => {
    const { rerender } = renderSync(SRV_A);
    await tick();
    await settle(0);

    rerender({ server: { ...SRV_A } });
    await tick();

    expect(syncLibrary).toHaveBeenCalledTimes(1);
  });

  it("retries a failed server on a backoff with the interval off", async () => {
    intervalSetting = "0";
    renderSync(SRV_A);
    await tick();
    await failRun(0, new Error("boom"));

    // The settle handler must not restart it, or an unreachable server is a hot loop.
    expect(syncLibrary).toHaveBeenCalledTimes(1);

    // failRun already advanced FANOUT_MS of the 30s first step.
    await tick(30 * 1000 - FANOUT_MS - 1);
    expect(syncLibrary).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(syncLibrary).toHaveBeenCalledTimes(2);
    expect(openRun(1).server.id).toBe("a");
  });

  it("gives up on a permanently failing server after the last backoff step", async () => {
    intervalSetting = "0";
    renderSync(SRV_A);
    await tick();

    // 30s, then 2min, then 5min, then nothing.
    await failRun(0, new Error("permanent"));
    await tick(30 * 1000);
    await failRun(1, new Error("permanent"));
    await tick(2 * MINUTE);
    await failRun(2, new Error("permanent"));
    await tick(5 * MINUTE);
    await failRun(3, new Error("permanent"));

    await tick(60 * MINUTE);
    expect(syncLibrary).toHaveBeenCalledTimes(4);
  });

  it("starts the backoff over after a run that succeeded", async () => {
    intervalSetting = "0";
    const { result } = renderSync(SRV_A);
    await tick();

    await failRun(0, new Error("boom"));
    await tick(30 * 1000);
    await settle(1);

    // The claim only clears on a retry, so the manual button is what reaches a
    // server that has already synced once.
    await act(async () => { result.current.runSync(SRV_A); });
    await failRun(2, new Error("boom"));

    // A fresh first step, not the second one the earlier failure would have left.
    await tick(30 * 1000);
    expect(syncLibrary).toHaveBeenCalledTimes(4);
  });

  it("does not retry a failed server after unmount", async () => {
    intervalSetting = "0";
    const { unmount } = renderSync(SRV_A);
    await tick();
    await failRun(0, new Error("boom"));
    unmount();

    await tick(60 * MINUTE);
    expect(syncLibrary).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useLibrarySync server switching", () => {
  it("syncs the server selected now, not the one the finished run started for", async () => {
    const { rerender } = renderSync(SRV_A);
    await tick();

    rerender({ server: SRV_B });
    await tick();
    expect(syncLibrary).toHaveBeenCalledTimes(1);

    await settle(0);
    expect(calledServerIds()).toEqual(["a", "b"]);
  });

  it("starts nothing when the server was cleared while the run was in flight", async () => {
    const { rerender } = renderSync(SRV_A);
    await tick();

    rerender({ server: undefined });
    await tick();
    await settle(0);

    expect(syncLibrary).toHaveBeenCalledTimes(1);
  });

  it("re-syncs a server returned to, because only the latest id is claimed", async () => {
    const { rerender } = renderSync(SRV_A);
    await tick();
    await settle(0);

    rerender({ server: SRV_B });
    await tick();
    await settle(1);

    rerender({ server: SRV_A });
    await tick();

    expect(calledServerIds()).toEqual(["a", "b", "a"]);
  });

  it("does nothing at all without a server", async () => {
    const { result } = renderSync(undefined);
    await tick(60 * MINUTE);

    expect(syncLibrary).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.syncStatus).toBe("idle");
    expect(result.current.syncError).toBe("");
    expect(result.current.lastSyncedAt).toBeNull();
  });

  it("syncs and arms exactly one interval once a server arrives", async () => {
    const { rerender } = renderSync(undefined);
    await tick();

    rerender({ server: SRV_A });
    await tick();

    expect(syncLibrary).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("tears the interval down when the server is removed", async () => {
    const { result, rerender } = renderSync(SRV_A);
    await tick();
    await settle(0);

    rerender({ server: undefined });
    await tick(60 * MINUTE);

    expect(vi.getTimerCount()).toBe(0);
    expect(syncLibrary).toHaveBeenCalledTimes(1);
    // Current behavior: the last server's status is not reset when it goes away.
    expect(result.current.syncStatus).toBe("done");
  });
});

describe("useLibrarySync auto-sync interval", () => {
  it("keeps syncing on each interval tick, bypassing the claimed-server guard", async () => {
    renderSync(SRV_A);
    await tick();
    await settle(0);

    await tick(5 * MINUTE);
    expect(syncLibrary).toHaveBeenCalledTimes(2);
    await settle(1);

    await tick(5 * MINUTE);
    expect(syncLibrary).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["0", false],
    ["-5", false],
    ["", false],
    [" ", false],
    ["abc", false],
    // parseInt is lenient: both of these arm an interval, which pins that the setting is unvalidated.
    ["5abc", true],
    ["2.7", true],
  ])("arms an interval for %j: %s", async (setting, armed) => {
    intervalSetting = setting;
    renderSync(SRV_A);
    await tick();
    await settle(0);

    expect(vi.getTimerCount()).toBe(armed ? 1 : 0);
  });

  it("rounds a fractional interval down to whole minutes", async () => {
    intervalSetting = "2.7";
    renderSync(SRV_A);
    await tick();
    await settle(0);

    // The interval is armed at mount, so `settle` has already consumed FANOUT_MS of it.
    await tick(2 * MINUTE - FANOUT_MS - 1);
    expect(syncLibrary).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(syncLibrary).toHaveBeenCalledTimes(2);
  });

  it("restarts the countdown when the stored interval arrives after first paint", async () => {
    intervalSetting = "5";
    const { rerender } = renderSync(SRV_A);
    await tick();
    await settle(0);

    await tick(4 * MINUTE);
    intervalSetting = "10";
    rerender({ server: SRV_A });
    await tick();

    // The 5-minute timer was cleared before firing; the 10-minute one starts from zero.
    await tick(1 * MINUTE);
    expect(syncLibrary).toHaveBeenCalledTimes(1);
    await tick(9 * MINUTE);
    expect(syncLibrary).toHaveBeenCalledTimes(2);
  });

  it("keeps counting down when a new server object arrives each render", async () => {
    const { rerender } = renderSync(SRV_A);
    await tick();
    await settle(0);

    // App.tsx derives `server` from a react-query result, so an equal-but-new object is routine.
    // Re-arming on each one would reset the countdown before any 5-minute tick could land.
    for (let i = 0; i < 8; i++) {
      rerender({ server: { ...SRV_A } });
      await tick(4 * MINUTE);
      await settle(runs.length - 1);
    }

    expect(vi.getTimerCount()).toBe(1);
    // 32 simulated minutes at a 5-minute interval, plus the mount sync.
    expect(syncLibrary).toHaveBeenCalledTimes(7);
  });

  it("syncs the server selected now when a tick lands after a switch", async () => {
    const { rerender } = renderSync(SRV_A);
    await tick();
    await settle(0);

    rerender({ server: SRV_B });
    await tick();
    await settle(1);

    await tick(5 * MINUTE);
    expect(openRun(2).server.id).toBe("b");
  });

  it("holds exactly one interval across a remount", async () => {
    const first = renderSync(SRV_A);
    await tick();
    await settle(0);
    first.unmount();

    const second = renderSync(SRV_A);
    await tick();
    await settle(1);

    expect(vi.getTimerCount()).toBe(1);
    await tick(5 * MINUTE);
    expect(syncLibrary).toHaveBeenCalledTimes(3);
    second.unmount();
  });

  it("stops syncing after unmount", async () => {
    const { unmount } = renderSync(SRV_A);
    await tick();
    await settle(0);
    unmount();

    await tick(60 * MINUTE);
    expect(vi.getTimerCount()).toBe(0);
    expect(syncLibrary).toHaveBeenCalledTimes(1);
  });

  it("still runs the settle fan-out for a sync that outlives its hook", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    const { unmount } = renderSync(SRV_A, client);
    await tick();

    unmount();
    await settle(0, { changed: { albums: true } });

    // Current behavior: there is no abort path, so an unmounted hook still invalidates.
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("useLibrarySync failure reporting", () => {
  it("reports an Error's message and leaves the last-synced stamp alone", async () => {
    const { result } = renderSync(SRV_A);
    await tick();
    await failRun(0, new Error("network down"));

    expect(result.current.syncStatus).toBe("error");
    expect(result.current.syncError).toBe("network down");
    expect(result.current.lastSyncedAt).toBeNull();
    expect(result.current.syncProgress).toBeNull();
    expect(consoleError).toHaveBeenCalledWith("Sync failed:", expect.any(Error));
  });

  it.each([
    ["nope", "nope"],
    [{ code: 1 }, "[object Object]"],
  ])("stringifies a non-Error rejection %j", async (thrown, message) => {
    const { result } = renderSync(SRV_A);
    await tick();
    await failRun(0, thrown);

    expect(result.current.syncStatus).toBe("error");
    expect(result.current.syncError).toBe(message);
  });

  it("clears a previous error when the next run starts", async () => {
    const { result } = renderSync(SRV_A);
    await tick();
    await failRun(0, new Error("boom"));

    await tick(5 * MINUTE);
    expect(result.current.syncStatus).toBe("syncing");
    expect(result.current.syncError).toBe("");
  });
});

describe("useLibrarySync retry countdown", () => {
  it("stamps when the scheduled retry will land", async () => {
    intervalSetting = "0";
    const { result } = renderSync(SRV_A);
    await tick();
    const armedAt = Date.now();
    await failRun(0, new Error("boom"));

    expect(result.current.nextRetryAt).toBe(armedAt + 30 * 1000);
  });

  it("moves the stamp on to the next backoff step after a second failure", async () => {
    intervalSetting = "0";
    const { result } = renderSync(SRV_A);
    await tick();
    await failRun(0, new Error("boom"));
    await tick(30 * 1000);

    const armedAt = Date.now();
    await failRun(1, new Error("boom"));

    expect(result.current.nextRetryAt).toBe(armedAt + 2 * MINUTE);
  });

  it("clears the stamp once the backoff is spent, so the banner stops promising a retry", async () => {
    intervalSetting = "0";
    const { result } = renderSync(SRV_A);
    await tick();

    await failRun(0, new Error("permanent"));
    await tick(30 * 1000);
    await failRun(1, new Error("permanent"));
    await tick(2 * MINUTE);
    await failRun(2, new Error("permanent"));
    await tick(5 * MINUTE);
    await failRun(3, new Error("permanent"));

    expect(result.current.syncStatus).toBe("error");
    expect(result.current.nextRetryAt).toBeNull();
  });

  it("clears the stamp when the next run starts", async () => {
    intervalSetting = "0";
    const { result } = renderSync(SRV_A);
    await tick();
    await failRun(0, new Error("boom"));
    expect(result.current.nextRetryAt).not.toBeNull();

    await tick(30 * 1000);

    expect(result.current.syncStatus).toBe("syncing");
    expect(result.current.nextRetryAt).toBeNull();
  });

  it("clears the stamp when the retry fires for a server no longer selected", async () => {
    intervalSetting = "0";
    const { result, rerender } = renderSync(SRV_A);
    await tick();
    await failRun(0, new Error("boom"));
    expect(result.current.nextRetryAt).not.toBeNull();

    rerender({ server: undefined });
    await tick(30 * 1000);

    expect(syncLibrary).toHaveBeenCalledTimes(1);
    expect(result.current.nextRetryAt).toBeNull();
  });
});
