import { describe, expect, it } from "vitest";
import { LASTFM_PLACEHOLDER, normalizeTrackTitle, resolvePortraitUrl } from "./lastfm";

describe("normalizeTrackTitle", () => {
  it("lowercases and strips non-alphanumeric characters", () => {
    expect(normalizeTrackTitle("Song!! 's Title")).toBe("songstitle");
  });

  it("strips a parenthesized suffix entirely, including feat. inside it", () => {
    expect(normalizeTrackTitle("Song (feat. Other Artist)")).toBe("song");
  });

  it("strips a bracketed suffix", () => {
    expect(normalizeTrackTitle("Song [Remastered 2011]")).toBe("song");
  });

  it("strips a dash-prefixed feat. suffix outside brackets", () => {
    expect(normalizeTrackTitle("Song - feat. Other Artist")).toBe("song");
  });

  it("strips a bare feat. suffix with no dash", () => {
    expect(normalizeTrackTitle("Song feat. Other Artist")).toBe("song");
  });

  it("strips ft (no period) the same as feat.", () => {
    expect(normalizeTrackTitle("Song ft Other Artist")).toBe("song");
  });

  it("does not strip a bare dash suffix that isn't feat./ft.", () => {
    // Only bracket contents get removed unconditionally; a trailing "- Live" outside
    // brackets has no feat./ft. keyword, so it survives and gets alnum-collapsed.
    expect(normalizeTrackTitle("Song - Live")).toBe("songlive");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeTrackTitle("")).toBe("");
  });
});

describe("resolvePortraitUrl", () => {
  it("returns null when enrichment is null", () => {
    expect(resolvePortraitUrl(null)).toBeNull();
  });

  it("returns null when every source is null", () => {
    expect(
      resolvePortraitUrl({ lastfm_image_url: null, wikidata_image_url: null, navidrome_image_url: null })
    ).toBeNull();
  });

  it("prefers wikidata over navidrome and lastfm", () => {
    expect(
      resolvePortraitUrl({
        lastfm_image_url: "https://lastfm/img.jpg",
        wikidata_image_url: "https://wikidata/img.jpg",
        navidrome_image_url: "https://navidrome/img.jpg",
      })
    ).toBe("https://wikidata/img.jpg");
  });

  it("falls back to navidrome when wikidata is absent", () => {
    expect(
      resolvePortraitUrl({
        lastfm_image_url: "https://lastfm/img.jpg",
        wikidata_image_url: null,
        navidrome_image_url: "https://navidrome/img.jpg",
      })
    ).toBe("https://navidrome/img.jpg");
  });

  it("falls back to a non-placeholder lastfm image when wikidata and navidrome are absent", () => {
    expect(
      resolvePortraitUrl({
        lastfm_image_url: "https://lastfm/img.jpg",
        wikidata_image_url: null,
        navidrome_image_url: null,
      })
    ).toBe("https://lastfm/img.jpg");
  });

  it("filters out lastfm's generic placeholder image", () => {
    expect(
      resolvePortraitUrl({
        lastfm_image_url: `https://lastfm/${LASTFM_PLACEHOLDER}.png`,
        wikidata_image_url: null,
        navidrome_image_url: null,
      })
    ).toBeNull();
  });

  it("treats a missing navidrome_image_url key the same as null", () => {
    expect(
      resolvePortraitUrl({ lastfm_image_url: null, wikidata_image_url: "https://wikidata/img.jpg" })
    ).toBe("https://wikidata/img.jpg");
  });
});
