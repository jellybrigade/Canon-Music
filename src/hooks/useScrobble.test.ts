// @vitest-environment jsdom
/**
 * Baseline coverage for `src/hooks/useScrobble.ts` - the producer that puts a play into
 * `scrobble_queue` once the threshold is crossed. The drain side is `useScrobbleFlush.test.ts`.
 *
 * Regression pinned: known-issues "A claim stamped when work starts, and cleared only when it
 * succeeds, is permanent after the first failure". The stamp on entry is deliberate (it is what
 * stops a second row per play), so the rejection path owes it a decision, and the retry it arms
 * has to be bounded or a locked database turns the 200ms position tick into a hot write loop.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/navidrome", async () => {
  const actual = await vi.importActual<typeof import("../lib/navidrome")>("../lib/navidrome");
  return { ...actual, reportNowPlaying: vi.fn().mockResolvedValue(undefined) };
});

import { renderHook, act, cleanup } from "@testing-library/react";
import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { usePlayerStore, type CurrentTrack } from "../store/player";
import type { NavidromeCredential } from "../lib/navidrome";
import type { Server } from "../types/server";
import type { ServerWithCredential } from "./useServer";
import { useScrobble } from "./useScrobble";

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
const SWC: ServerWithCredential = { server: SRV, credential: CRED };

/** 200s long, so the default 50% threshold is crossed at 100s elapsed. */
function makeTrack(id = "srv-a:t1"): CurrentTrack {
  return { id, title: `Track ${id}`, artist: "Artist", duration: 200, albumId: "srv-a:alb", album: "Album" };
}

let db: FakeDatabase;
let consoleError: ReturnType<typeof vi.spyOn>;

function queueRows(): { track_id: string }[] {
  return db.raw.prepare("SELECT track_id FROM scrobble_queue ORDER BY id").all() as { track_id: string }[];
}

/** Every `INSERT INTO scrobble_queue` attempted, successful or not. */
function insertAttempts(): number {
  return db.queryLog.filter((q) => q.sql.startsWith("INSERT INTO scrobble_queue")).length;
}

/**
 * Makes every `scrobble_queue` insert reject, as a locked database or a full disk would.
 * Other statements (the settings reads) go through untouched.
 */
function failQueueWrites() {
  const real = db.execute.bind(db);
  db.execute = (sql: string, binds?: unknown[]) => {
    if (sql.trim().startsWith("INSERT INTO scrobble_queue")) {
      db.queryLog.push({ kind: "execute", sql: sql.trim() });
      return Promise.reject(new Error("database is locked"));
    }
    return real(sql, binds);
  };
}

/** Drives one position poll: the store's `elapsed` moving is what re-runs the effect. */
async function tickTo(elapsed: number) {
  await act(async () => {
    usePlayerStore.setState({ elapsed });
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  usePlayerStore.setState({ elapsed: 0, playStartedAt: 1000 });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  vi.clearAllMocks();
});

describe("useScrobble", () => {
  it("queues the play once the threshold is crossed", async () => {
    const track = makeTrack();
    renderHook(() => useScrobble(track, SWC));

    await tickTo(50);
    expect(queueRows()).toHaveLength(0);

    await tickTo(120);
    expect(queueRows().map((r) => r.track_id)).toEqual(["srv-a:t1"]);
  });

  it("writes exactly one row however many position polls follow the threshold", async () => {
    const track = makeTrack();
    renderHook(() => useScrobble(track, SWC));

    for (const elapsed of [120, 130, 140, 150, 160]) await tickTo(elapsed);

    expect(insertAttempts()).toBe(1);
    expect(queueRows()).toHaveLength(1);
  });

  it("retries on the next position poll when the queue write fails", async () => {
    failQueueWrites();
    const track = makeTrack();
    renderHook(() => useScrobble(track, SWC));

    await tickTo(120);
    expect(insertAttempts()).toBe(1);

    await tickTo(130);
    expect(insertAttempts()).toBe(2);
  });

  it("writes the row when a retry finds the database healthy again", async () => {
    const real = db.execute.bind(db);
    let failNext = true;
    db.execute = (sql: string, binds?: unknown[]) => {
      if (failNext && sql.trim().startsWith("INSERT INTO scrobble_queue")) {
        failNext = false;
        db.queryLog.push({ kind: "execute", sql: sql.trim() });
        return Promise.reject(new Error("database is locked"));
      }
      return real(sql, binds);
    };

    renderHook(() => useScrobble(makeTrack(), SWC));

    await tickTo(120);
    expect(queueRows()).toHaveLength(0);

    await tickTo(130);
    expect(queueRows().map((r) => r.track_id)).toEqual(["srv-a:t1"]);

    for (const elapsed of [140, 150, 160]) await tickTo(elapsed);
    expect(queueRows()).toHaveLength(1);
  });

  it("gives up after a bounded number of failed writes instead of retrying every poll", async () => {
    failQueueWrites();
    renderHook(() => useScrobble(makeTrack(), SWC));

    for (const elapsed of [120, 125, 130, 135, 140, 145, 150, 155, 160]) await tickTo(elapsed);

    expect(insertAttempts()).toBe(3);
  });

  it("retries again for the next play after a previous play exhausted its attempts", async () => {
    failQueueWrites();
    const { rerender } = renderHook(({ track }: { track: CurrentTrack }) => useScrobble(track, SWC), {
      initialProps: { track: makeTrack() },
    });

    for (const elapsed of [120, 125, 130, 135, 140]) await tickTo(elapsed);
    expect(insertAttempts()).toBe(3);

    await act(async () => {
      usePlayerStore.setState({ elapsed: 0, playStartedAt: 2000 });
      await Promise.resolve();
    });
    rerender({ track: makeTrack("srv-a:t2") });

    await tickTo(120);
    expect(insertAttempts()).toBe(4);
  });
});
