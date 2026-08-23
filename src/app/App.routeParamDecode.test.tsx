// @vitest-environment jsdom
//
// Acceptance-level: mounts the real `App` at each of the three detail routes with an id or an
// artist name that survives `encodeURIComponent` -> router-decode intact, and asserts the
// route addresses the row the path was built from.
//
// All three routes called `decodeURIComponent` on a param react-router had already decoded, so
// the value the route looked the row up with was not the value `albumPath`/`artistPath`/
// `playlistPath` encoded. Two failure modes, both pinned here: a literal `%` makes the second
// decode throw `URIError` (in the artist and playlist routes that throw is in the render body,
// so it takes the whole tree down), and a name containing the literal text `%20` or `%41`
// decodes a second time into a space or an "A" and silently addresses a row that is not there.
// Everything else - slashes, hashes, ampersands, spaces, unicode - is idempotent under a
// second decode, which is why the defect went unnoticed: only `%` can see it.
//
// The paths are built with the real `albumPath`/`artistPath`/`playlistPath` rather than
// hand-encoded, so these tests cover the producer/consumer pair rather than one half of it.
//
// Only boundaries are mocked: Tauri `invoke`/`listen`, the SQLite handle, the keychain, the
// updater and the remote-notice fetch. The three detail subtrees and `PlayerBar` are stubbed
// because they fetch over the network; the stubs re-expose the identifying prop as an
// attribute, because "which row did the route resolve" is exactly what this file asserts.
// `AppRoutes` itself is real, because it is the subject.
vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../lib/updater", () => ({ checkForUpdate: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/notice", () => ({ fetchRemoteNotice: vi.fn().mockResolvedValue(null) }));
vi.mock("../keychain", () => ({
  keychain: {
    get: vi.fn().mockResolvedValue(
      JSON.stringify({ type: "token", username: "u", token: "t", salt: "s" }),
    ),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../db", () => ({ getDb: vi.fn(async () => testDb) }));
vi.mock("../components/AlbumDetail", () => ({
  AlbumDetail: ({ album }: { album: { id: string } }) => (
    <div data-testid="album-detail" data-album-id={album.id} />
  ),
}));
vi.mock("../components/ArtistDetail", () => ({
  ArtistDetail: ({ artist }: { artist: { name: string; album_count: number } }) => (
    <div
      data-testid="artist-detail"
      data-artist-name={artist.name}
      data-album-count={String(artist.album_count)}
    />
  ),
}));
vi.mock("../components/PlaylistDetail", () => ({
  PlaylistDetail: ({ playlist }: { playlist: { id: string } }) => (
    <div data-testid="playlist-detail" data-playlist-id={playlist.id} />
  ),
}));
vi.mock("../components/PlayerBar", () => ({ PlayerBar: () => <div data-testid="player-bar" /> }));
vi.mock("../hooks/useScrobble", () => ({ ScrobbleTracker: () => null }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { allowSlowAppMounts } from "../test/appMount";
import { albumPath, artistPath, playlistPath } from "../lib/routes";
import { onInvoke, resetTauriMocks } from "../test/mocks/tauri";
import { usePlaylistSessionStore } from "../store/playlistSessionStore";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";

allowSlowAppMounts();

let testDb: FakeDatabase;

const ALBUM_MISSING_COPY = /no longer here/i;
const PLAYLIST_MISSING_COPY = /that playlist is no longer here/i;

/**
 * Ids and names that a second `decodeURIComponent` destroys. `%` alone throws `URIError`;
 * `%20` and `%41` are valid escape sequences as text, so a second decode silently turns them
 * into a space and an "A" and addresses a row nobody asked for.
 */
const HOSTILE = ["100%", "al%20b", "srv-a:50%", "%41", "50%25"] as const;

/**
 * The controls. Every one of these is idempotent under a second decode, so they pass with the
 * bug in place - they are here so a fix that broke ordinary names would be caught too.
 */
const BENIGN = ["AC/DC", "Sigur Rós", "a b", "#1 Record", "P!nk", "a&b", "中文"] as const;

async function seedServer() {
  testDb = await createMigratedTestDb();
  await testDb.execute(
    "INSERT INTO servers (id, type, url, display_name, username) VALUES (?, 'navidrome', ?, ?, ?)",
    ["srv-a", "https://example.test", "Test", "u"],
  );
}

async function seedAlbum(id: string) {
  await testDb.execute(
    "INSERT INTO albums (id, server_id, server_type, name, artist, year) VALUES (?, ?, 'navidrome', ?, ?, ?)",
    [id, "srv-a", "Album Name", "Artist Name", 2020],
  );
}

async function seedArtist(name: string) {
  await testDb.execute(
    "INSERT INTO artists (name, server_id, server_type, album_count) VALUES (?, ?, 'navidrome', ?)",
    [name, "srv-a", 3],
  );
}

/** Playlists load over `invoke("get_playlists")` (the rusqlite read path), not the SQL plugin. */
function seedPlaylist(id: string) {
  onInvoke("get_playlists", () => [
    {
      id,
      server_id: "srv-a",
      name: "Playlist Name",
      comment: null,
      track_count: 1,
      cover_art_url: null,
      custom_cover_data: null,
      is_smart: 0,
      rules_json: null,
    },
  ]);
}

function mountAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  resetTauriMocks();
  // usePlaylists caches its rows on this store across mounts, and the store is module-level,
  // so a previous test's playlist would answer this one's lookup.
  usePlaylistSessionStore.setState({ rows: undefined, cachedTick: -1 });
  await seedServer();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the album route resolves the id the path was built from", () => {
  it.each([...HOSTILE, ...BENIGN])("finds the album whose id is %s", async (id) => {
    await seedAlbum(id);
    mountAt(albumPath(id));

    expect(await screen.findByTestId("album-detail")).toHaveAttribute("data-album-id", id);
    expect(screen.queryByText(ALBUM_MISSING_COPY)).not.toBeInTheDocument();
  });

  it("does not resolve a different album when the id reads as an escape sequence", async () => {
    // A second decode turns "al%20b" into "al b". Both rows exist, so a route that decodes
    // twice renders the wrong album rather than reporting a miss - the silent half of the bug.
    await seedAlbum("srv-a:al%20b");
    await seedAlbum("srv-a:al b");
    mountAt(albumPath("srv-a:al%20b"));

    expect(await screen.findByTestId("album-detail")).toHaveAttribute(
      "data-album-id",
      "srv-a:al%20b",
    );
  });
});

describe("the artist route resolves the name the path was built from", () => {
  it.each([...HOSTILE, ...BENIGN])("finds the artist named %s", async (name) => {
    await seedArtist(name);
    mountAt(artistPath(name));

    const detail = await screen.findByTestId("artist-detail");
    expect(detail).toHaveAttribute("data-artist-name", name);
    // The library row, not the minimal row the route synthesizes for an artist it cannot find.
    expect(detail).toHaveAttribute("data-album-count", "3");
  });

  it("keeps the app shell up for a name containing a bare percent sign", async () => {
    // This decode is in the render body, so a `URIError` here escapes render and React unmounts
    // the entire tree - not just the route. The chrome outside the route is what proves the
    // difference between "this route could not resolve" and "the app is gone". Asserted on the
    // player bar rather than on `render()` throwing, because React 19 reports an error thrown
    // during render as an uncaught exception, so a `.not.toThrow()` here would pass vacuously.
    await seedArtist("100%");
    mountAt(artistPath("100%"));

    expect(await screen.findByTestId("player-bar")).toBeInTheDocument();
  });

  it("synthesizes the fallback row under the name in the URL, not a decoded variant", async () => {
    // Nothing seeded: a similar-artist card can navigate to a name the library does not hold,
    // and the route builds a minimal row from the URL. That name is what everything downstream
    // enriches and looks up by, so a second decode misfiles it.
    mountAt(artistPath("Blink%20182"));

    const detail = await screen.findByTestId("artist-detail");
    expect(detail).toHaveAttribute("data-artist-name", "Blink%20182");
    expect(detail).toHaveAttribute("data-album-count", "0");
  });
});

describe("the playlist route resolves the id the path was built from", () => {
  it.each([...HOSTILE, ...BENIGN])("finds the playlist whose id is %s", async (id) => {
    seedPlaylist(id);
    mountAt(playlistPath(id));

    expect(await screen.findByTestId("playlist-detail")).toHaveAttribute("data-playlist-id", id);
    expect(screen.queryByText(PLAYLIST_MISSING_COPY)).not.toBeInTheDocument();
  });

  it("keeps the app shell up for an id containing a bare percent sign", async () => {
    // Same render-body throw as the artist route, so the same shell assertion. See the note
    // there for why this is not written as `expect(...).not.toThrow()`.
    seedPlaylist("srv-a:50%");
    mountAt(playlistPath("srv-a:50%"));

    expect(await screen.findByTestId("player-bar")).toBeInTheDocument();
  });
});
