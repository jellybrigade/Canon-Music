// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { getDb } from "../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import { useAppearsOnAlbums, useArtistGenres, useArtistSeedTrack } from "./artistQueries";

let db: FakeDatabase;

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
});

afterEach(async () => {
  await db.close();
});

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function settle<T>(hook: () => { isSuccess: boolean; data: T | undefined }): Promise<T> {
  const { result } = renderHook(hook, { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  return result.current.data as T;
}

function seedAlbum(id: string, name: string, artist: string, year: number | null = 2000): void {
  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist, year) VALUES (?, 'srv', 'navidrome', ?, ?, ?)`,
    )
    .run(id, name, artist, year);
}

function seedTrack(id: string, artist: string, albumId: string): void {
  db.raw
    .prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id, track_number, play_count)
       VALUES (?, 'srv', 'navidrome', 'Same', ?, ?, 1, 0)`,
    )
    .run(id, artist, albumId);
}

// Rows are inserted in descending id order, so scan order disagrees with id order on every tie.
describe("artist page reads cut ties the same way every time", () => {
  it("picks the lowest id as the radio seed among equally played tracks", async () => {
    seedAlbum("srv:al1", "Kid A", "Radiohead");
    for (const id of ["srv:t3", "srv:t2", "srv:t1"]) seedTrack(id, "Radiohead", "srv:al1");
    const seed = await settle(() => useArtistSeedTrack("Radiohead", "srv"));
    expect(seed?.id).toBe("srv:t1");
  });

  it("orders appears-on albums sharing a year and name by id", async () => {
    for (const id of ["srv:al3", "srv:al2", "srv:al1"]) {
      seedAlbum(id, "Compilation", "Various");
      seedTrack(`${id}-t`, "Radiohead", id);
    }
    const albums = await settle(() => useAppearsOnAlbums("Radiohead", "srv"));
    expect(albums.map((a) => a.id)).toEqual(["srv:al1", "srv:al2", "srv:al3"]);
  });

  it("orders equally common genres by name and names each genre the same way", async () => {
    seedAlbum("srv:al1", "Kid A", "Radiohead");
    seedAlbum("srv:al2", "Amnesiac", "Radiohead");
    const insert = db.raw.prepare(
      `INSERT INTO album_genres (album_id, canonical_id, relation, name) VALUES (?, ?, 'direct', ?)`,
    );
    insert.run("srv:al1", "a-zydeco", "Zydeco");
    insert.run("srv:al2", "a-zydeco", "Zydeco");
    insert.run("srv:al2", "b-electronic", "Electronic");
    insert.run("srv:al1", "b-electronic", "electronic");
    const genres = await settle(() => useArtistGenres("Radiohead", "srv"));
    expect(genres).toEqual(["Electronic", "Zydeco"]);
  });
});
