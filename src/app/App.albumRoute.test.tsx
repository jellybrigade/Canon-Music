// @vitest-environment jsdom
//
// Acceptance-level: mounts the real `App` at `/album/:albumId` and asserts which subtree the
// route paints for each state of the album lookup. `AlbumDetailRoute` collapsed "still
// loading", "not in the mirror" and "no server credential" into a single `return null`, so an
// album id absent from the local mirror painted a blank page with no way to tell the three
// apart. `PlaylistDetailRoute` was fixed for the same defect already; this file pins the album
// route to that precedent.
//
// Only boundaries are mocked: Tauri `invoke`/`listen`, the SQLite handle, the keychain, the
// updater and the remote-notice fetch. Two stubs are not boundaries and are deliberate:
// `AlbumDetail` (a large subtree that fetches tracks, loved state and enrichment over the
// network, none of which is what this file asserts) and `PlayerBar`. `AppRoutes` itself is
// real, unlike in the other `App.*` acceptance files, because it is the subject here.
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
  AlbumDetail: ({ album }: { album: { id: string; server_id: string } }) => (
    <div data-testid="album-detail" data-album-id={album.id} data-server-id={album.server_id} />
  ),
}));
vi.mock("../components/PlayerBar", () => ({ PlayerBar: () => <div data-testid="player-bar" /> }));
vi.mock("../hooks/useScrobble", () => ({ ScrobbleTracker: () => null }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import App from "../App";
import { allowSlowAppMounts } from "../test/appMount";
import { resetTauriMocks } from "../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";

allowSlowAppMounts();

let testDb: FakeDatabase;

const MISSING_COPY = /no longer here/i;
const LOADING_COPY = /loading album/i;

async function seedServer() {
  testDb = await createMigratedTestDb();
  // `created_at` is explicit because `useServer` orders by it and the column's default has
  // one-second resolution, so the second server below would otherwise tie with this one and
  // leave which server is selected up to the storage order.
  await testDb.execute(
    "INSERT INTO servers (id, type, url, display_name, username, created_at) VALUES (?, 'navidrome', ?, ?, ?, ?)",
    ["srv-a", "https://example.test", "Test", "u", "2020-01-01 00:00:00"],
  );
}

/** A second, later-added server. `useServer` orders by `created_at`, so `srv-a` stays selected. */
async function seedOtherServer() {
  await testDb.execute(
    "INSERT INTO servers (id, type, url, display_name, username, created_at) VALUES (?, 'navidrome', ?, ?, ?, ?)",
    ["srv-b", "https://other.test", "Other", "u2", "2021-01-01 00:00:00"],
  );
}

async function seedAlbum(id: string, serverId = "srv-a") {
  await testDb.execute(
    "INSERT INTO albums (id, server_id, server_type, name, artist, year) VALUES (?, ?, 'navidrome', ?, ?, ?)",
    [id, serverId, "Album Name", "Artist Name", 2020],
  );
}

/**
 * Holds the album lookup open so the pending branch can be observed. Every other `select` the
 * app makes still runs against the real migrated DB, so the shell mounts normally.
 */
function deferAlbumLookup() {
  const original = testDb.select.bind(testDb);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  testDb.select = (async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM albums WHERE id")) {
      await gate;
    }
    return original(sql, params as never);
  }) as typeof testDb.select;
  return release;
}

function LocationProbe() {
  return <div data-testid="pathname">{useLocation().pathname}</div>;
}

function mountAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  resetTauriMocks();
  await seedServer();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the album route when the id is not in the mirror", () => {
  it("tells the user the album is gone instead of painting a blank page", async () => {
    await seedAlbum("srv-a:alb1");
    mountAt("/album/srv-a%3Amissing");

    expect(await screen.findByText(MISSING_COPY)).toBeInTheDocument();
    expect(screen.queryByTestId("album-detail")).not.toBeInTheDocument();
  });

  it("keeps the page chrome so the shell does not collapse around the message", async () => {
    const { container } = mountAt("/album/srv-a%3Amissing");

    await screen.findByText(MISSING_COPY);
    expect(container.querySelector("main.library")).not.toBeNull();
  });

  it("treats a whitespace-only id as missing rather than as no id at all", async () => {
    mountAt("/album/%20");

    expect(await screen.findByText(MISSING_COPY)).toBeInTheDocument();
  });
});

describe("the album route while the lookup is still running", () => {
  it("does not accuse the album of being gone before the read settles", async () => {
    await seedAlbum("srv-a:alb1");
    const release = deferAlbumLookup();
    mountAt("/album/srv-a%3Aalb1");

    expect(await screen.findByText(LOADING_COPY)).toBeInTheDocument();
    expect(screen.queryByText(MISSING_COPY)).not.toBeInTheDocument();

    release();
    expect(await screen.findByTestId("album-detail")).toBeInTheDocument();
    expect(screen.queryByText(LOADING_COPY)).not.toBeInTheDocument();
  });
});

describe("the album route when the id resolves", () => {
  it("renders the album and never the missing-album message", async () => {
    await seedAlbum("srv-a:alb1");
    mountAt("/album/srv-a%3Aalb1");

    const detail = await screen.findByTestId("album-detail");
    expect(detail).toHaveAttribute("data-album-id", "srv-a:alb1");
    expect(screen.queryByText(MISSING_COPY)).not.toBeInTheDocument();
  });

  it("hands down the row's own server_id, not the selected server's", async () => {
    await seedAlbum("srv-a:alb1");
    mountAt("/album/srv-a%3Aalb1");

    expect(await screen.findByTestId("album-detail")).toHaveAttribute("data-server-id", "srv-a");
  });

  it("does not report an album with no synced tracks as missing", async () => {
    await seedAlbum("srv-a:empty");
    mountAt("/album/srv-a%3Aempty");

    expect(await screen.findByTestId("album-detail")).toBeInTheDocument();
    expect(screen.queryByText(MISSING_COPY)).not.toBeInTheDocument();
  });
});

describe("the album route with two servers configured", () => {
  it("refuses an album belonging to a server other than the selected one", async () => {
    await seedOtherServer();
    await seedAlbum("srv-b:alb1", "srv-b");
    mountAt("/album/srv-b%3Aalb1");

    expect(await screen.findByText(MISSING_COPY)).toBeInTheDocument();
    expect(screen.queryByTestId("album-detail")).not.toBeInTheDocument();
  });

  it("still resolves the selected server's own album", async () => {
    await seedOtherServer();
    await seedAlbum("srv-a:alb1");
    await seedAlbum("srv-b:alb1", "srv-b");
    mountAt("/album/srv-a%3Aalb1");

    const detail = await screen.findByTestId("album-detail");
    expect(detail).toHaveAttribute("data-server-id", "srv-a");
    expect(screen.queryByText(MISSING_COPY)).not.toBeInTheDocument();
  });
});

describe("the album route with no id at all", () => {
  it("redirects a bare /album/ to home rather than rendering the detail route", async () => {
    mountAt("/album/");

    await waitFor(() => expect(screen.getByTestId("pathname")).toHaveTextContent("/home"));
    expect(screen.queryByText(MISSING_COPY)).not.toBeInTheDocument();
  });
});
