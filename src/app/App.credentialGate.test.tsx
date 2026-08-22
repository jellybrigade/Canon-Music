// @vitest-environment jsdom
//
// Acceptance-level: mounts the real `App` at each of the three detail routes and asserts what
// they paint while the keychain round-trip for the server credential is still in flight, and
// after it fails. All three did a bare `return null` on a falsy `serverWithCred`, which is the
// same pending-vs-absent collapse `App.albumRoute.test.tsx` pins for the album *lookup*, one
// prerequisite earlier.
//
// The "no server configured" case is deliberately absent: `App` renders the setup wizard when
// the `servers` table is empty, so a detail route only ever mounts with a server row present.
// A falsy `serverWithCred` there means the credential query is pending or has rejected - and
// because that query is `retry: false`, a rejection is permanent, so the blank page was
// forever rather than transient.
//
// Only boundaries are mocked: Tauri `invoke`/`listen`, the SQLite handle, the keychain, the
// updater and the remote-notice fetch. The three detail subtrees and `PlayerBar` are stubbed
// because they fetch over the network and none of it is what this file asserts; `AppRoutes`
// itself is real, because it is the subject.
vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../lib/updater", () => ({ checkForUpdate: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/notice", () => ({ fetchRemoteNotice: vi.fn().mockResolvedValue(null) }));
vi.mock("../keychain", () => ({
  keychain: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));
vi.mock("../db", () => ({ getDb: vi.fn(async () => testDb) }));
vi.mock("../components/AlbumDetail", () => ({
  AlbumDetail: () => <div data-testid="album-detail" />,
}));
vi.mock("../components/ArtistDetail", () => ({
  ArtistDetail: () => <div data-testid="artist-detail" />,
}));
vi.mock("../components/PlaylistDetail", () => ({
  PlaylistDetail: () => <div data-testid="playlist-detail" />,
}));
vi.mock("../components/PlayerBar", () => ({ PlayerBar: () => <div data-testid="player-bar" /> }));
vi.mock("../hooks/useScrobble", () => ({ ScrobbleTracker: () => null }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { allowSlowAppMounts } from "../test/appMount";
import { keychain } from "../keychain";
import { resetTauriMocks } from "../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";

allowSlowAppMounts();

let testDb: FakeDatabase;

const CRED_LOADING_COPY = /connecting to your server/i;
const CRED_ERROR_COPY = /could not read the saved credential/i;

const GOOD_CRED = JSON.stringify({ type: "token", username: "u", token: "t", salt: "s" });

/** Every route is exercised against the same gate, so they are driven table-wise. */
const ROUTES = [
  { name: "album", path: "/album/srv-a%3Aalb1", detail: "album-detail" },
  { name: "artist", path: "/artist/Artist%20Name", detail: "artist-detail" },
  { name: "playlist", path: "/playlist/srv-a%3Apl1", detail: "playlist-detail" },
] as const;

async function seedServer() {
  testDb = await createMigratedTestDb();
  await testDb.execute(
    "INSERT INTO servers (id, type, url, display_name, username) VALUES (?, 'navidrome', ?, ?, ?)",
    ["srv-a", "https://example.test", "Test", "u"],
  );
  await testDb.execute(
    "INSERT INTO albums (id, server_id, server_type, name, artist, year) VALUES (?, ?, 'navidrome', ?, ?, ?)",
    ["srv-a:alb1", "srv-a", "Album Name", "Artist Name", 2020],
  );
  await testDb.execute(
    "INSERT INTO artists (name, server_id, server_type, album_count) VALUES (?, ?, 'navidrome', ?)",
    ["Artist Name", "srv-a", 1],
  );
}

/**
 * Holds the keychain read open so the pending branch can be observed. Returns a release that
 * resolves it with a usable credential, so one test can watch the gate open.
 */
function deferKeychain() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(keychain.get).mockImplementation(async () => {
    await gate;
    return GOOD_CRED;
  });
  return release;
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
  vi.mocked(keychain.get).mockResolvedValue(GOOD_CRED);
  await seedServer();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a detail route while the credential round-trip is in flight", () => {
  it.each(ROUTES)(
    "the $name route says it is connecting instead of painting a blank page",
    async ({ path }) => {
      deferKeychain();
      mountAt(path);

      expect(await screen.findByText(CRED_LOADING_COPY)).toBeInTheDocument();
      expect(screen.queryByText(CRED_ERROR_COPY)).not.toBeInTheDocument();
    },
  );

  it.each(ROUTES)("the $name route keeps its page chrome while connecting", async ({ path }) => {
    deferKeychain();
    const { container } = mountAt(path);

    await screen.findByText(CRED_LOADING_COPY);
    expect(container.querySelector("main.library")).not.toBeNull();
  });

  it("hands over to the route's own content once the credential resolves", async () => {
    const release = deferKeychain();
    mountAt("/album/srv-a%3Aalb1");

    await screen.findByText(CRED_LOADING_COPY);
    release();

    expect(await screen.findByTestId("album-detail")).toBeInTheDocument();
    expect(screen.queryByText(CRED_LOADING_COPY)).not.toBeInTheDocument();
  });
});

describe("a detail route when the credential cannot be read", () => {
  it.each(ROUTES)("the $name route explains the failure rather than staying blank", async ({ path }) => {
    vi.mocked(keychain.get).mockRejectedValue(new Error("No matching entry found"));
    mountAt(path);

    expect(await screen.findByText(CRED_ERROR_COPY)).toBeInTheDocument();
    expect(screen.queryByText(CRED_LOADING_COPY)).not.toBeInTheDocument();
  });

  it("surfaces the underlying keyring message so the cause is not swallowed", async () => {
    vi.mocked(keychain.get).mockRejectedValue(new Error("the keyring is locked"));
    mountAt("/album/srv-a%3Aalb1");

    await screen.findByText(CRED_ERROR_COPY);
    expect(screen.getByText(/the keyring is locked/i)).toBeInTheDocument();
  });

  // The credential query is `retry: false`, so the failure is terminal: nothing re-reads the
  // keyring on its own and the route must not drift back to a loading state that will never
  // resolve. Asserted as a settled state rather than as a call count, because `lib/sync.ts`
  // reads the same keychain entry with the same arguments and the two callers are
  // indistinguishable through this harness (recorded in donow.md).
  it("keeps the failure on screen instead of drifting back to a loading state", async () => {
    vi.mocked(keychain.get).mockRejectedValue(new Error("No matching entry found"));
    mountAt("/artist/Artist%20Name");

    await screen.findByText(CRED_ERROR_COPY);
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByText(CRED_ERROR_COPY)).toBeInTheDocument();
    expect(screen.queryByText(CRED_LOADING_COPY)).not.toBeInTheDocument();
  });
});
