// @vitest-environment jsdom
vi.mock("../db", () => ({ getDb: vi.fn() }));

import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { invalidateGenreTreeCache } from "../features/tags/hooks/useGenreTree";
import { bustCanonTreeCache } from "../features/tags/lib/canonicalize";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { GenreView } from "./GenreView";

let db: FakeDatabase;

async function seedAlbums(canonicalId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await db.execute(`INSERT INTO album_genres (album_id, canonical_id, relation, name) VALUES (?, ?, 'direct', ?)`, [
      `${canonicalId}-${i}`,
      canonicalId,
      canonicalId,
    ]);
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

  it("shows a failed read as an error with a retry, not an endless loading line", async () => {
    vi.mocked(getDb).mockRejectedValueOnce(new Error("db locked"));
    await seedAlbums("rock", 3);
    const { container } = await mount();

    expect(container.querySelector(".genre-view__loading")).toBeNull();
    expect(container.querySelector(".empty-state-hint")?.textContent).toBe("db locked");

    await act(async () => {
      fireEvent.click(container.querySelector(".empty-state-action")!);
    });
    const counts = [...container.querySelectorAll(".genre-column .genre-col-count")];
    expect(counts.map((c) => c.textContent)).toEqual(["3 albums"]);
  });
});
