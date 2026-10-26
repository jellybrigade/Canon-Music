// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../test/mocks/tauri")).eventModule);
vi.mock("../../db", () => ({ getDb: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getDb } from "../../db";
import type { ServerWithCredential } from "../../hooks/useServer";
import { resetTauriMocks } from "../../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import { usePlayerStore } from "../playback/store/player";
import type { CurrentTrack } from "../playback/store/playerTypes";
import { PlaylistDetail } from "./PlaylistDetail";
import type { PlaylistRow } from "./usePlaylists";

const SWC: ServerWithCredential = {
  server: {
    id: "srv-a",
    type: "navidrome",
    url: "https://music.example",
    alt_url: null,
    display_name: "Home",
    username: "marcel",
    created_at: "2026-01-01T00:00:00Z",
  },
  credential: { type: "md5", token: "tok", salt: "salt" },
};

const PLAYLIST: PlaylistRow = {
  id: "srv-a:pl",
  server_id: "srv-a",
  name: "Mix",
  comment: null,
  track_count: 3,
  cover_art_url: null,
  custom_cover_data: null,
  is_smart: 0,
  rules_json: null,
};

let db: FakeDatabase;
const playQueue = vi.fn();

function seedTrack(position: number, title: string, duration: number) {
  const id = `srv-a:t${position}`;
  db.raw
    .prepare("INSERT INTO tracks (id, server_id, server_type, title, duration) VALUES (?, 'srv-a', 'navidrome', ?, ?)")
    .run(id, title, duration);
  db.raw
    .prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)")
    .run(PLAYLIST.id, id, position);
}

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlaylistDetail
        playlist={PLAYLIST}
        serverWithCredential={SWC}
        onClose={() => {}}
        onDelete={async () => {}}
        onRename={async () => {}}
      />
    </QueryClientProvider>,
  );
}

function queuedTitles(): string[] {
  const queue = playQueue.mock.lastCall?.[0] as CurrentTrack[] | undefined;
  return queue?.map((track) => track.title) ?? [];
}

async function playAll() {
  const play = screen.getByRole("button", { name: "Play playlist" });
  await waitFor(() => expect(play).toBeEnabled());
  fireEvent.click(play);
}

beforeEach(async () => {
  resetTauriMocks();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  db.raw
    .prepare("INSERT INTO playlists (id, server_id, name, track_count) VALUES (?, 'srv-a', 'Mix', 3)")
    .run(PLAYLIST.id);
  seedTrack(0, "Bravo", 300);
  seedTrack(1, "Alpha", 100);
  seedTrack(2, "Charlie", 200);
  playQueue.mockReset();
  usePlayerStore.setState({ playQueue });
});

afterEach(() => {
  cleanup();
});

describe("PlaylistDetail column sort", () => {
  it("plays in playlist order until a column is chosen", async () => {
    renderDetail();
    await playAll();
    expect(queuedTitles()).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("sorts by a clicked column, reverses on a second click, and restores playlist order on a third", async () => {
    renderDetail();
    const title = screen.getByRole("button", { name: "Title" });

    fireEvent.click(title);
    await playAll();
    expect(queuedTitles()).toEqual(["Alpha", "Bravo", "Charlie"]);

    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    await playAll();
    expect(queuedTitles()).toEqual(["Charlie", "Bravo", "Alpha"]);

    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    await playAll();
    expect(queuedTitles()).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("sorts by duration", async () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Duration" }));
    await playAll();
    expect(queuedTitles()).toEqual(["Alpha", "Charlie", "Bravo"]);
  });
});
