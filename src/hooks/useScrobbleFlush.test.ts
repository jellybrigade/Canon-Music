// @vitest-environment jsdom
/**
 * Baseline coverage for `src/hooks/useScrobbleFlush.ts`: the drain loop's permanent-vs-
 * recoverable error split, the in-flight guard, the write ordering around the queue DELETE,
 * and the interval/listener lifecycle.
 *
 * Two known-issues entries live in this file and both get an explicit regression test:
 * "A drain loop that breaks on any error blocks on its first permanent failure" (code 70
 * drops and continues, 40/41/50 break and keep the backlog, no overlapping flushes) and
 * "A skip fast-path freezes every column only the skipped path writes" (both
 * `tracks.play_count` and `albums.play_count` move, and only after the queue DELETE).
 *
 * The producer that fills `scrobble_queue` (`useScrobble.ts`) shares only the table name and
 * is a separate scope; rows are seeded directly here.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/navidrome", async () => {
  // `SubsonicError` must stay the real class: the hook's permanent-error branch gates on
  // `instanceof`, so a hand-rolled look-alike would test nothing.
  const actual = await vi.importActual<typeof import("../lib/navidrome")>("../lib/navidrome");
  return { ...actual, scrobbleTrack: vi.fn() };
});

import React from "react";
import { renderHook, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { SubsonicError, scrobbleTrack, type NavidromeCredential } from "../lib/navidrome";
import { QK } from "../lib/query-keys";
import type { Server } from "../types/server";
import type { ServerWithCredential } from "./useServer";
import { useScrobbleFlush } from "./useScrobbleFlush";

const FLUSH_MS = 60_000;

const SRV: Server = {
  id: "srv-a",
  type: "navidrome",
  url: "https://music.example",
  alt_url: null,
  display_name: "Home",
  username: "marcel",
  created_at: "2026-01-01T00:00:00Z",
};

const CRED: NavidromeCredential = { type: "md5", token: "tok", salt: "salt" };

function swc(server: Server = SRV): ServerWithCredential {
  return { server, credential: CRED };
}

let db: FakeDatabase;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

/** Seeds one `scrobble_queue` row. `title`/`artist` are NOT NULL in the schema. */
function seedQueue(trackId: string, timestamp: number) {
  db.raw
    .prepare("INSERT INTO scrobble_queue (track_id, title, artist, timestamp) VALUES (?, ?, ?, ?)")
    .run(trackId, `title-${trackId}`, "Some Artist", timestamp);
}

/** Seeds a track and, unless `albumId` is null, the album it belongs to. */
function seedTrack(trackId: string, albumId: string | null = `${trackId}-alb`) {
  if (albumId) {
    db.raw
      .prepare("INSERT OR IGNORE INTO albums (id, server_id, server_type, name) VALUES (?, ?, 'navidrome', ?)")
      .run(albumId, SRV.id, `album ${albumId}`);
  }
  db.raw
    .prepare("INSERT INTO tracks (id, server_id, server_type, title, album_id) VALUES (?, ?, 'navidrome', ?, ?)")
    .run(trackId, SRV.id, `title ${trackId}`, albumId);
}

function queueTrackIds(): string[] {
  return db.raw
    .prepare("SELECT track_id FROM scrobble_queue ORDER BY id")
    .all()
    .map((r) => (r as { track_id: string }).track_id);
}

function historyRows(): { track_id: string; timestamp: number }[] {
  return db.raw
    .prepare("SELECT track_id, timestamp FROM scrobble_history ORDER BY id")
    .all() as { track_id: string; timestamp: number }[];
}

function trackPlayCount(trackId: string): number {
  const row = db.raw.prepare("SELECT play_count FROM tracks WHERE id = ?").get(trackId);
  return (row as { play_count: number }).play_count;
}

function albumPlayCount(albumId: string): number {
  const row = db.raw.prepare("SELECT play_count FROM albums WHERE id = ?").get(albumId);
  return (row as { play_count: number }).play_count;
}

/** Every `execute` statement seen so far, collapsed to its verb + table, in order. */
function writeShapes(): string[] {
  return db.queryLog
    .filter((q) => q.kind === "execute")
    .map((q) => {
      const sql = q.sql.replace(/\s+/g, " ").trim();
      if (sql.startsWith("INSERT OR IGNORE INTO scrobble_history")) return "history";
      if (sql.startsWith("DELETE FROM scrobble_queue")) return "delete";
      if (sql.startsWith("UPDATE tracks")) return "track+1";
      if (sql.startsWith("UPDATE albums")) return "album+1";
      return sql;
    });
}

type Deferred = { resolve: () => void; reject: (e: unknown) => void };
let pending: Deferred[] = [];

/** Makes `scrobbleTrack` hang until the test resolves it, so overlap is observable. */
function armDeferredScrobble() {
  vi.mocked(scrobbleTrack).mockImplementation(
    () =>
      new Promise<void>((res, rej) => {
        pending.push({ resolve: () => res(), reject: rej });
      })
  );
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

/** Flushes the promise chain plus any timers due within `ms`. */
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// Deliberately no default for `value`: `renderFlush(undefined)` must render the
// no-server path, which a default parameter would silently turn back into a server.
function renderFlush(value: ServerWithCredential | undefined, client = makeClient()) {
  const view = renderHook(
    ({ v }: { v: ServerWithCredential | undefined }) => useScrobbleFlush(v),
    { initialProps: { v: value }, wrapper: wrapperFor(client) }
  );
  return { ...view, client };
}

beforeEach(async () => {
  vi.clearAllMocks();
  pending = [];
  db = await createMigratedTestDb();
  (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  vi.mocked(scrobbleTrack).mockResolvedValue(undefined);
  vi.useFakeTimers();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  // Explicit, not decorative: vitest runs without `globals: true`, so RTL cannot register
  // its own auto-cleanup. Without this every test leaves its hook mounted, and a later
  // `window.dispatchEvent(new Event("online"))` fires one live listener per earlier test.
  cleanup();
  vi.useRealTimers();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  await db.close();
});

describe("useScrobbleFlush drain", () => {
  it("sends every queued row once and empties the queue", async () => {
    seedQueue("srv-a:t1", 1700000001);
    seedQueue("srv-a:t2", 1700000002);
    seedQueue("srv-a:t3", 1700000003);
    ["srv-a:t1", "srv-a:t2", "srv-a:t3"].forEach((id) => seedTrack(id));

    renderFlush(swc());
    await tick();

    expect(scrobbleTrack).toHaveBeenCalledTimes(3);
    expect(queueTrackIds()).toEqual([]);
    expect(historyRows().map((r) => r.track_id)).toEqual(["srv-a:t1", "srv-a:t2", "srv-a:t3"]);
  });

  it("sends the queue timestamp in milliseconds and a null alt_url as undefined", async () => {
    seedQueue("srv-a:t1", 1700000000);
    seedTrack("srv-a:t1");

    renderFlush(swc());
    await tick();

    expect(scrobbleTrack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(scrobbleTrack).mock.calls[0]).toEqual([
      "https://music.example",
      "marcel",
      CRED,
      "t1", // server prefix stripped
      1700000000000, // seconds in the table, milliseconds on the wire
      undefined,
    ]);
  });

  it("passes the server's alt_url through when it has one", async () => {
    seedQueue("srv-a:t1", 1700000000);
    seedTrack("srv-a:t1");

    renderFlush(swc({ ...SRV, alt_url: "https://alt.example" }));
    await tick();

    expect(vi.mocked(scrobbleTrack).mock.calls[0]![5]).toBe("https://alt.example");
  });

  it("sends rows oldest first", async () => {
    seedQueue("srv-a:late", 1700000900);
    seedQueue("srv-a:early", 1700000100);
    seedTrack("srv-a:late");
    seedTrack("srv-a:early");

    renderFlush(swc());
    await tick();

    expect(vi.mocked(scrobbleTrack).mock.calls.map((c) => c[3])).toEqual(["early", "late"]);
  });

  it("skips rows owned by another server and leaves them queued", async () => {
    seedQueue("srv-b:t9", 1700000001);
    seedQueue("srv-a:t1", 1700000002);
    seedTrack("srv-a:t1");

    renderFlush(swc());
    await tick();

    expect(vi.mocked(scrobbleTrack).mock.calls.map((c) => c[3])).toEqual(["t1"]);
    expect(queueTrackIds()).toEqual(["srv-b:t9"]);
  });

  it("drains a row whose track is no longer in the library without throwing", async () => {
    seedQueue("srv-a:ghost", 1700000000); // no matching `tracks` row

    renderFlush(swc());
    await tick();

    expect(scrobbleTrack).toHaveBeenCalledTimes(1);
    expect(queueTrackIds()).toEqual([]);
    expect(historyRows()).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("useScrobbleFlush play counts", () => {
  // Regression, known-issues "A skip fast-path freezes every column only the skipped path
  // writes": `tracks.play_count` lived in the usually-skipped sync branch and froze, while
  // `albums.play_count` kept moving and hid it. Both columns are asserted separately on
  // purpose - asserting only the album column is exactly what let the bug ship.
  it("increments both tracks.play_count and albums.play_count after a send", async () => {
    seedQueue("srv-a:t1", 1700000000);
    seedTrack("srv-a:t1", "alb-1");

    renderFlush(swc());
    await tick();

    expect(trackPlayCount("srv-a:t1")).toBe(1);
    expect(albumPlayCount("alb-1")).toBe(1);
  });

  // Same entry: the increments sit deliberately after the DELETE so a crash in the window
  // undercounts rather than double-counts. Order, not just presence, is the property.
  it("writes history, deletes the queue row, then increments the counts, in that order", async () => {
    seedQueue("srv-a:t1", 1700000000);
    seedTrack("srv-a:t1", "alb-1");

    renderFlush(swc());
    await tick();

    expect(writeShapes()).toEqual(["history", "delete", "track+1", "album+1"]);
  });

  it("increments the track count when the track has no album", async () => {
    seedQueue("srv-a:t1", 1700000000);
    seedTrack("srv-a:t1", null);

    renderFlush(swc());
    await tick();

    expect(trackPlayCount("srv-a:t1")).toBe(1);
    expect(writeShapes()).toEqual(["history", "delete", "track+1", "album+1"]);
  });

  it("counts a duplicated queue row twice while collapsing it to one history row", async () => {
    // `scrobble_history` is UNIQUE (track_id, timestamp) so the second INSERT OR IGNORE is a
    // no-op, but both queue rows are sent and both increment. Pinning current behavior.
    seedQueue("srv-a:t1", 1700000000);
    seedQueue("srv-a:t1", 1700000000);
    seedTrack("srv-a:t1", "alb-1");

    renderFlush(swc());
    await tick();

    expect(scrobbleTrack).toHaveBeenCalledTimes(2);
    expect(historyRows()).toHaveLength(1);
    expect(trackPlayCount("srv-a:t1")).toBe(2);
    expect(albumPlayCount("alb-1")).toBe(2);
    expect(queueTrackIds()).toEqual([]);
  });

  it("does not increment a count for a row dropped as permanently unsendable", async () => {
    seedQueue("srv-a:t1", 1700000000);
    seedTrack("srv-a:t1", "alb-1");
    vi.mocked(scrobbleTrack).mockRejectedValueOnce(new SubsonicError("scrobble.view", 70));

    renderFlush(swc());
    await tick();

    expect(trackPlayCount("srv-a:t1")).toBe(0);
    expect(albumPlayCount("alb-1")).toBe(0);
  });
});

describe("useScrobbleFlush error handling", () => {
  // Regression, known-issues "A drain loop that breaks on any error blocks on its first
  // permanent failure": code 70 means the server deleted the track, so the row fails forever
  // and used to wall off every scrobble queued behind it.
  it("drops a row on Subsonic error 70 and keeps sending the rest", async () => {
    seedQueue("srv-a:t1", 1700000001);
    seedQueue("srv-a:t2", 1700000002);
    seedQueue("srv-a:t3", 1700000003);
    ["srv-a:t1", "srv-a:t2", "srv-a:t3"].forEach((id) => seedTrack(id));
    vi.mocked(scrobbleTrack).mockRejectedValueOnce(new SubsonicError("scrobble.view", 70));

    renderFlush(swc());
    await tick();

    expect(scrobbleTrack).toHaveBeenCalledTimes(3);
    expect(queueTrackIds()).toEqual([]);
    // The dropped row is gone from the queue but was never actually scrobbled.
    expect(historyRows().map((r) => r.track_id)).toEqual(["srv-a:t2", "srv-a:t3"]);
  });

  // Same entry: 40/41/50 are recoverable by re-entering the password, so dropping the rows
  // would delete the user's offline backlog.
  it.each([40, 41, 50])(
    "stops the batch and keeps the whole backlog on auth error %i",
    async (code) => {
      seedQueue("srv-a:t1", 1700000001);
      seedQueue("srv-a:t2", 1700000002);
      seedQueue("srv-a:t3", 1700000003);
      ["srv-a:t1", "srv-a:t2", "srv-a:t3"].forEach((id) => seedTrack(id));
      vi.mocked(scrobbleTrack).mockRejectedValue(new SubsonicError("scrobble.view", code));

      const { client } = renderFlush(swc());
      const invalidate = vi.spyOn(client, "invalidateQueries");
      await tick();

      expect(scrobbleTrack).toHaveBeenCalledTimes(1);
      expect(queueTrackIds()).toEqual(["srv-a:t1", "srv-a:t2", "srv-a:t3"]);
      expect(historyRows()).toEqual([]);
      expect(invalidate).not.toHaveBeenCalled();
    }
  );

  it("stops the batch on a Subsonic error carrying no code", async () => {
    // `callSubsonicVoid` reads `response.error?.code ?? null`, so a malformed error body
    // produces code null. The permanent branch requires a code, so this must not drop.
    seedQueue("srv-a:t1", 1700000001);
    seedQueue("srv-a:t2", 1700000002);
    vi.mocked(scrobbleTrack).mockRejectedValue(new SubsonicError("scrobble.view", null));

    renderFlush(swc());
    await tick();

    expect(scrobbleTrack).toHaveBeenCalledTimes(1);
    expect(queueTrackIds()).toEqual(["srv-a:t1", "srv-a:t2"]);
  });

  it("stops the batch on an unenumerated Subsonic code", async () => {
    seedQueue("srv-a:t1", 1700000001);
    seedQueue("srv-a:t2", 1700000002);
    vi.mocked(scrobbleTrack).mockRejectedValue(new SubsonicError("scrobble.view", 30));

    renderFlush(swc());
    await tick();

    expect(scrobbleTrack).toHaveBeenCalledTimes(1);
    expect(queueTrackIds()).toEqual(["srv-a:t1", "srv-a:t2"]);
  });

  it("stops the batch on a transport error that is not a SubsonicError", async () => {
    // An HTTP failure surfaces as a plain Error from `callSubsonicVoid`, not a SubsonicError.
    seedQueue("srv-a:t1", 1700000001);
    seedQueue("srv-a:t2", 1700000002);
    vi.mocked(scrobbleTrack).mockRejectedValue(new Error("scrobble.view returned 500"));

    renderFlush(swc());
    await tick();

    expect(scrobbleTrack).toHaveBeenCalledTimes(1);
    expect(queueTrackIds()).toEqual(["srv-a:t1", "srv-a:t2"]);
  });

  it("retries a row that failed recoverably on the next tick", async () => {
    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");
    vi.mocked(scrobbleTrack).mockRejectedValueOnce(new SubsonicError("scrobble.view", 40));

    renderFlush(swc());
    await tick();
    expect(queueTrackIds()).toEqual(["srv-a:t1"]);

    await tick(FLUSH_MS);

    expect(scrobbleTrack).toHaveBeenCalledTimes(2);
    expect(queueTrackIds()).toEqual([]);
  });

  it("swallows a database failure and leaves the suite a logged error", async () => {
    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");
    const realExecute = db.execute.bind(db);
    let failed = false;
    db.execute = async (sql: string, binds?: unknown[]) => {
      if (!failed && sql.startsWith("DELETE FROM scrobble_queue")) {
        failed = true;
        throw new Error("disk is on fire");
      }
      return realExecute(sql, binds);
    };

    renderFlush(swc());
    await tick();

    expect(consoleError).toHaveBeenCalledTimes(1);
    // The row was scrobbled and its history written, but the DELETE failed, so it is still
    // queued and will be re-sent. The counts never moved, which is the undercount the
    // post-DELETE ordering buys.
    expect(queueTrackIds()).toEqual(["srv-a:t1"]);
    expect(trackPlayCount("srv-a:t1")).toBe(0);
  });
});

describe("useScrobbleFlush in-flight guard", () => {
  // Regression, known-issues "no in-flight guard let a slow pass overlap the 60s tick and
  // double-scrobble". A scrobble is non-idempotent, so a second send is a real duplicate.
  it("does not start a second flush while one is still running", async () => {
    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");
    armDeferredScrobble();

    renderFlush(swc());
    await tick();
    expect(scrobbleTrack).toHaveBeenCalledTimes(1);

    await tick(FLUSH_MS * 3);

    expect(scrobbleTrack).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0]!.resolve();
    });
    expect(queueTrackIds()).toEqual([]);
  });

  it("does not start an overlapping flush from the online event", async () => {
    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");
    armDeferredScrobble();

    renderFlush(swc());
    await tick();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(scrobbleTrack).toHaveBeenCalledTimes(1);
  });

  it("flushes when the browser comes back online", async () => {
    renderFlush(swc());
    await tick();
    expect(scrobbleTrack).not.toHaveBeenCalled();

    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(scrobbleTrack).toHaveBeenCalledTimes(1);
    expect(queueTrackIds()).toEqual([]);
  });
});

describe("useScrobbleFlush invalidation", () => {
  it("invalidates the three listening-stat keys once a flush sent something", async () => {
    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");

    const { client } = renderFlush(swc());
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await tick();

    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(invalidate.mock.calls.map((c) => c[0]!.queryKey)).toEqual([
      QK.albumsListeningStats(),
      QK.albumsPartiallyHeard(),
      QK.scrobbleQueueCount(),
    ]);
  });

  it("does not invalidate when the queue was empty", async () => {
    const { client } = renderFlush(swc());
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await tick();

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not invalidate after unmount, but still finishes the row already in flight", async () => {
    seedQueue("srv-a:t1", 1700000001);
    seedQueue("srv-a:t2", 1700000002);
    seedTrack("srv-a:t1");
    seedTrack("srv-a:t2");
    armDeferredScrobble();

    const { unmount, client } = renderFlush(swc());
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await tick();

    unmount();
    await act(async () => {
      pending[0]!.resolve();
    });

    // The cancelled check sits at the top of the loop, so the in-flight row completes its
    // writes and the next row is skipped.
    expect(queueTrackIds()).toEqual(["srv-a:t2"]);
    expect(trackPlayCount("srv-a:t1")).toBe(1);
    expect(scrobbleTrack).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("useScrobbleFlush lifecycle and waste", () => {
  // These three assert the listener by firing it rather than by counting
  // `addEventListener` calls: React Query's own `onlineManager` subscribes to the same
  // window event, so a spy on `window.addEventListener` counts its listener too.
  it("arms nothing without a server", async () => {
    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");

    renderFlush(undefined);
    await tick();

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await tick(FLUSH_MS * 5);
    expect(scrobbleTrack).not.toHaveBeenCalled();
  });

  it("flushes immediately on mount rather than waiting for the first tick", async () => {
    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");

    renderFlush(swc());
    await tick(0);

    expect(scrobbleTrack).toHaveBeenCalledTimes(1);
  });

  it("flushes again on each interval tick", async () => {
    renderFlush(swc());
    await tick();

    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");
    await tick(FLUSH_MS);
    expect(scrobbleTrack).toHaveBeenCalledTimes(1);

    seedQueue("srv-a:t2", 1700000002);
    seedTrack("srv-a:t2");
    await tick(FLUSH_MS);
    expect(scrobbleTrack).toHaveBeenCalledTimes(2);
  });

  it("holds exactly one interval and one online listener when the effect re-arms", async () => {
    const { rerender } = renderFlush(swc());
    await tick();
    // A new object identity from `useServerWithCredential` re-runs the effect.
    rerender({ v: swc() });
    await tick();
    rerender({ v: swc() });
    await tick();

    expect(vi.getTimerCount()).toBe(1);

    // A stale listener left behind by an earlier arming would own its own `flushing` flag,
    // so it would send the row a second time rather than being blocked by the live one.
    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");
    armDeferredScrobble();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(scrobbleTrack).toHaveBeenCalledTimes(1);
  });

  it("tears down the interval and the online listener on unmount", async () => {
    const { unmount } = renderFlush(swc());
    await tick();
    unmount();

    expect(vi.getTimerCount()).toBe(0);

    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await tick(FLUSH_MS * 10);
    expect(scrobbleTrack).not.toHaveBeenCalled();
  });

  it("tears down when the server goes away and re-arms when it returns", async () => {
    const { rerender } = renderFlush(swc());
    await tick();

    rerender({ v: undefined });
    await tick();
    expect(vi.getTimerCount()).toBe(0);

    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");
    rerender({ v: swc() });
    await tick();

    expect(vi.getTimerCount()).toBe(1);
    expect(scrobbleTrack).toHaveBeenCalledTimes(1);
  });

  it("reads once and writes nothing on a tick over an already drained queue", async () => {
    seedQueue("srv-a:t1", 1700000001);
    seedTrack("srv-a:t1");

    const { client } = renderFlush(swc());
    await tick();
    expect(queueTrackIds()).toEqual([]);

    const invalidate = vi.spyOn(client, "invalidateQueries");
    const selectsBefore = db.selectCount;
    const executesBefore = db.executeCount;
    await tick(FLUSH_MS);

    expect(db.selectCount - selectsBefore).toBe(1);
    expect(db.executeCount - executesBefore).toBe(0);
    expect(scrobbleTrack).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
