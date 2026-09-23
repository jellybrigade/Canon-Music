// @vitest-environment jsdom
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { GenreView } from "./GenreView";
import { getDb } from "../db";
import { bustCanonTreeCache } from "../features/tags/lib/canonicalize";
import { invalidateGenreTreeCache } from "../features/tags/hooks/useGenreTree";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";

let db: FakeDatabase;

async function seedAlbums(canonicalId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await db.execute(
      `INSERT INTO album_genres (album_id, canonical_id, relation, name) VALUES (?, ?, 'direct', ?)`,
      [`${canonicalId}-${i}`, canonicalId, canonicalId],
    );
  }
}

async function mount() {
  const utils = render(<GenreView onSelectGenre={vi.fn()} onPlayGenre={vi.fn()} />);
  await act(async () => {});
  return utils;
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  bustCanonTreeCache();
  invalidateGenreTreeCache();
});

describe("GenreView", () => {
  it("names the unit of the album count in search results", async () => {
    await seedAlbums("rock", 3);
    await seedAlbums("alternative-rock", 2);
    await seedAlbums("shoegaze", 1);
    const { container } = await mount();

    fireEvent.change(container.querySelector(".genre-search__input")!, { target: { value: "shoegaze" } });

    const counts = [...container.querySelectorAll(".genre-search-result-row .genre-col-count")];
    expect(counts.map((c) => c.textContent)).toEqual(["1 album"]);
  });

  it("names the unit of the album count in the browse columns", async () => {
    await seedAlbums("rock", 3);
    const { container } = await mount();

    const counts = [...container.querySelectorAll(".genre-column .genre-col-count")];
    expect(counts.map((c) => c.textContent)).toEqual(["3 albums"]);
  });
});
