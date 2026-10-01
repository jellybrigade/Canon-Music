import { describe, expect, it } from "vitest";
import type { MbArtistCandidate } from "../../../clients/musicbrainz";
import {
  DEFAULT_ARTIST_AUTO_SELECT_SCORE,
  parseArtistAutoSelectScore,
  pickConfidentArtist,
} from "./artistAutoSelect";

function candidate(id: string, score: number | null): MbArtistCandidate {
  return { id, name: id, disambiguation: null, country: null, score };
}

describe("pickConfidentArtist", () => {
  it("picks the top artist at or above the minimum score", () => {
    expect(pickConfidentArtist([candidate("a", 95)], 95)?.id).toBe("a");
  });

  it("picks nothing when the top artist is below the minimum score", () => {
    expect(pickConfidentArtist([candidate("a", 94)], 95)).toBeNull();
  });

  it("picks nothing when a second artist scores within 5 of the top", () => {
    expect(pickConfidentArtist([candidate("a", 100), candidate("b", 95)], 95)).toBeNull();
  });

  it("picks the top artist when the runner-up is more than 5 behind", () => {
    expect(pickConfidentArtist([candidate("a", 100), candidate("b", 94)], 95)?.id).toBe("a");
  });

  it("ranks by score, not by the order MusicBrainz returned", () => {
    expect(pickConfidentArtist([candidate("b", 40), candidate("a", 100)], 95)?.id).toBe("a");
  });

  it("treats a missing score as no confidence", () => {
    expect(pickConfidentArtist([candidate("a", null)], 0)).toBeNull();
  });

  it("picks nothing from no candidates", () => {
    expect(pickConfidentArtist([], 95)).toBeNull();
  });
});

describe("parseArtistAutoSelectScore", () => {
  it("reads a stored percentage", () => {
    expect(parseArtistAutoSelectScore("80")).toBe(80);
  });

  it("keeps a legal zero", () => {
    expect(parseArtistAutoSelectScore("0")).toBe(0);
  });

  it("falls back to the default for empty or unreadable values", () => {
    expect(parseArtistAutoSelectScore("")).toBe(DEFAULT_ARTIST_AUTO_SELECT_SCORE);
    expect(parseArtistAutoSelectScore("abc")).toBe(DEFAULT_ARTIST_AUTO_SELECT_SCORE);
  });

  it("clamps to 0..100", () => {
    expect(parseArtistAutoSelectScore("150")).toBe(100);
    expect(parseArtistAutoSelectScore("-3")).toBe(0);
  });
});
