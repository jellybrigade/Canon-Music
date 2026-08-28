// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { getDb } from "../db";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { useArtistAlbums } from "./useArtistAlbums";
import { useArtistAlbumsSessionStore } from "../store/artistAlbumsSessionStore";

let db: FakeDatabase;

beforeEach(async () => {
  vi.clearAllMocks();
  useArtistAlbumsSessionStore.setState({ refreshTick: 0 });
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
});

afterEach(() => {
  cleanup();
});

function seedAlbum(serverId: string, suffix: string, artist: string): void {
  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist, year)
       VALUES (?, ?, 'navidrome', ?, ?, 2000)`
    )
    .run(`${serverId}:al${suffix}`, serverId, `Album ${suffix}`, artist);
}

function seedAlias(canonical: string, alias: string): void {
  db.raw
    .prepare("INSERT INTO artist_aliases (canonical_name, alias_name) VALUES (?, ?)")
    .run(canonical, alias);
}

// known-issues.md, the name-keyed form of the wrong-owner class: the artist name carries no
// server prefix, and every consumer renders these rows with the selected server's credential.
describe("useArtistAlbums server scoping", () => {
  it("returns only the selected server's albums for an artist both servers hold", async () => {
    seedAlbum("alpha", "1", "Burial");
    seedAlbum("beta", "2", "Burial");
    const { result } = renderHook(() => useArtistAlbums("Burial", "alpha"));
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.map((a) => a.id)).toEqual(["alpha:al1"]);
  });

  it("scopes the alias branch too, not just the direct name match", async () => {
    seedAlias("Burial", "William Bevan");
    seedAlbum("alpha", "1", "William Bevan");
    seedAlbum("beta", "2", "William Bevan");
    const { result } = renderHook(() => useArtistAlbums("Burial", "alpha"));
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.map((a) => a.id)).toEqual(["alpha:al1"]);
  });

  it("refetches under the new scope when the selected server changes", async () => {
    seedAlbum("alpha", "1", "Burial");
    seedAlbum("beta", "2", "Burial");
    const { result, rerender } = renderHook(
      ({ serverId }: { serverId: string }) => useArtistAlbums("Burial", serverId),
      { initialProps: { serverId: "alpha" } }
    );
    await waitFor(() => expect(result.current.data?.map((a) => a.id)).toEqual(["alpha:al1"]));
    rerender({ serverId: "beta" });
    await waitFor(() => expect(result.current.data?.map((a) => a.id)).toEqual(["beta:al2"]));
  });
});
