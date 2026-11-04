import { describe, expect, it } from "vitest";
import { groupGenresBySource } from "./albumGenres";

describe("groupGenresBySource", () => {
  it("gives Discogs styles their own group beside MusicBrainz", () => {
    const groups = groupGenresBySource([
      { id: "dream-pop", name: "Dream Pop", source: "musicbrainz" },
      { id: "shoegaze", name: "Shoegaze", source: "discogs" },
    ]);

    expect(groups.musicbrainz.map((g) => g.id)).toEqual(["dream-pop"]);
    expect(groups.discogs.map((g) => g.id)).toEqual(["shoegaze"]);
    expect(groups.unsourced).toEqual([]);
    expect(groups.multiSource).toBe(true);
  });

  it("files a genre with no source apart", () => {
    const groups = groupGenresBySource([{ id: "shoegaze", name: "Shoegaze" }]);

    expect(groups.unsourced.map((g) => g.id)).toEqual(["shoegaze"]);
    expect(groups.multiSource).toBe(false);
  });
});
