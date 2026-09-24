// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlaybackTab } from "./PlaybackTab";
import { usePlayerStore } from "../../playback/store/player";
import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";

let db: FakeDatabase;

function seedTrack(id: string, serverId: string, gains: { track?: number; album?: number } = {}) {
  db.raw
    .prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, replay_gain_track_gain, replay_gain_album_gain)
       VALUES (?, ?, 'navidrome', ?, ?, ?)`
    )
    .run(id, serverId, `title ${id}`, gains.track ?? null, gains.album ?? null);
}

function renderTab(serverId: string | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlaybackTab searchQuery="" serverId={serverId} />
    </QueryClientProvider>
  );
}

function coverageText(): string {
  return Array.from(document.querySelectorAll(".settings-coverage"))
    .map((el) => el.textContent ?? "")
    .join(" ");
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  usePlayerStore.setState({ replayGainMode: "album", replayGainFallbackGain: -6 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlaybackTab ReplayGain coverage", () => {
  it("says how much of the library the selected mode can normalize", async () => {
    seedTrack("t1", "srv-a", { album: -7.1, track: -7.4 });
    seedTrack("t2", "srv-a", { track: -6.0 });
    seedTrack("t3", "srv-a");
    seedTrack("t4", "srv-a");
    renderTab("srv-a");
    await waitFor(() => expect(coverageText()).toContain("1 of 4 tracks (25%) carry album gain"));
    expect(coverageText()).toContain("1 more fall back to track gain");
    expect(coverageText()).toContain("2 have no tags and play at the fallback gain (-6 dB)");
  });

  it("warns outright when a mode has no tags behind it at all", async () => {
    seedTrack("t1", "srv-a");
    renderTab("srv-a");
    await waitFor(() =>
      expect(coverageText()).toContain("No track in this library carries ReplayGain tags")
    );
    expect(coverageText()).toContain("sounds the same as Off");
  });

  it("re-reads nothing but re-words itself when the mode changes", async () => {
    seedTrack("t1", "srv-a", { track: -6.0 });
    seedTrack("t2", "srv-a", { album: -6.0 });
    renderTab("srv-a");
    await waitFor(() => expect(coverageText()).toContain("carry album gain"));
    const readsAfterMount = db.selectCount;
    usePlayerStore.setState({ replayGainMode: "track" });
    await waitFor(() => expect(coverageText()).toContain("carry track gain"));
    expect(db.selectCount).toBe(readsAfterMount);
  });

  it("shows what normalization would buy while the mode is off", async () => {
    usePlayerStore.setState({ replayGainMode: "off" });
    seedTrack("t1", "srv-a", { track: -6.0 });
    seedTrack("t2", "srv-a");
    renderTab("srv-a");
    await waitFor(() => expect(coverageText()).toContain("Tracks play at their original level"));
    expect(coverageText()).toContain("1 of 2 tracks (50%) carry ReplayGain tags");
  });

  it("paints no coverage claim before the count is in", () => {
    seedTrack("t1", "srv-a", { album: -6.0 });
    renderTab("srv-a");
    expect(coverageText()).toBe("");
  });
});
