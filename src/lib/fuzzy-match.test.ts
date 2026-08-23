import { describe, expect, it } from "vitest";
import {
  filterByTrackCount,
  normalizeForMatch,
  rankCandidates,
  scoreReleaseGroup,
  similarity,
} from "./fuzzy-match";
import type { MbReleaseGroupCandidate } from "./musicbrainz";

function candidate(over: Partial<MbReleaseGroupCandidate> = {}): MbReleaseGroupCandidate {
  return {
    id: over.id ?? "rg-1",
    title: over.title ?? "Some Album",
    artistName: over.artistName ?? "Some Artist",
    artistMbid: over.artistMbid ?? null,
    primaryType: over.primaryType ?? "Album",
    firstReleaseDate: over.firstReleaseDate ?? null,
    score: over.score ?? 100,
    ...over,
  } as MbReleaseGroupCandidate;
}

describe("normalizeForMatch", () => {
  it("folds case and strips diacritics", () => {
    expect(normalizeForMatch("Björk")).toBe("bjork");
    expect(normalizeForMatch("SIGUR RÓS")).toBe("sigur ros");
  });

  it("drops edition noise", () => {
    expect(normalizeForMatch("Nevermind (Deluxe Edition)")).toBe("nevermind");
    expect(normalizeForMatch("OK Computer [Remastered]")).toBe("ok computer");
    expect(normalizeForMatch("Album (2011 Remaster)")).toBe("album");
  });

  it("drops a leading article", () => {
    expect(normalizeForMatch("The Bends")).toBe("bends");
    expect(normalizeForMatch("A Love Supreme")).toBe("love supreme");
  });

  it("drops punctuation and collapses whitespace", () => {
    expect(normalizeForMatch("  Sgt.  Pepper's   Lonely  ")).toBe("sgt peppers lonely");
  });

  it("returns an empty string for input that is entirely punctuation", () => {
    expect(normalizeForMatch("!!!")).toBe("");
  });
});

describe("similarity", () => {
  it("is 1 for identical strings", () => {
    expect(similarity("Kid A", "Kid A")).toBe(1);
  });

  it("is 1 for strings that only differ in normalized noise", () => {
    expect(similarity("The Bends", "Bends (Remastered)")).toBe(1);
  });

  it("is symmetric", () => {
    expect(similarity("Amnesiac", "Amnesia")).toBe(similarity("Amnesia", "Amnesiac"));
  });

  it("is 0 when either side normalizes to empty", () => {
    expect(similarity("", "Kid A")).toBe(0);
    expect(similarity("???", "Kid A")).toBe(0);
  });

  it("decreases monotonically as edits accumulate", () => {
    const one = similarity("abcdefgh", "abcdefgx");
    const two = similarity("abcdefgh", "abcdefxx");
    const three = similarity("abcdefgh", "abcdexxx");
    expect(one).toBeGreaterThan(two);
    expect(two).toBeGreaterThan(three);
  });

  it("stays within 0 and 1 for wildly different lengths", () => {
    const s = similarity("a", "an extremely long album title indeed");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(0.2);
  });
});

describe("scoreReleaseGroup", () => {
  it("scores an exact artist and title match at 1", () => {
    expect(scoreReleaseGroup(candidate({ title: "Kid A", artistName: "Radiohead" }), "Radiohead", "Kid A")).toBe(1);
  });

  it("treats a collaboration credit as matching one of its members", () => {
    const c = candidate({ title: "Sun", artistName: "Filow & Ski Aggu" });
    expect(scoreReleaseGroup(c, "Filow", "Sun")).toBe(1);
  });

  it("gives a whole-word containment boost to a suffixed local title", () => {
    const plain = candidate({ title: "BRAT", artistName: "Charli xcx" });
    expect(scoreReleaseGroup(plain, "Charli xcx", "BRAT (Dolby Atmos Mix)")).toBeGreaterThanOrEqual(0.85);
  });

  it("does not boost on a bare substring that is not a whole word", () => {
    const generic = candidate({ title: "Live", artistName: "Some Artist" });
    const withBoost = scoreReleaseGroup(generic, "Some Artist", "Oliver Twist");
    expect(withBoost).toBeLessThan(0.75);
  });

  it("nudges an exact year match up and pulls a real year mismatch down", () => {
    const base = { title: "Sisterhood", artistName: "Some Artist" };
    const right = candidate({ ...base, firstReleaseDate: "2019-04-01" });
    const wrong = candidate({ ...base, firstReleaseDate: "1994-04-01", title: "Sisterhod" });
    expect(scoreReleaseGroup(right, "Some Artist", "Sisterhood", 2019)).toBeGreaterThan(
      scoreReleaseGroup(wrong, "Some Artist", "Sisterhood", 2019)
    );
  });

  it("does not punish a reissue year gap when the title matches closely", () => {
    const c = candidate({ title: "Kid A", artistName: "Radiohead", firstReleaseDate: "2000-10-02" });
    expect(scoreReleaseGroup(c, "Radiohead", "Kid A", 2016)).toBe(1);
  });

  it("overrides the artist component when the MBID is already confirmed", () => {
    const c = candidate({ title: "Kid A", artistName: "Completely Different Name", artistMbid: "mbid-1" });
    expect(scoreReleaseGroup(c, "Radiohead", "Kid A", null, "mbid-1")).toBe(1);
  });

  it("clamps into 0..1", () => {
    const c = candidate({ title: "zzzz", artistName: "qqqq", firstReleaseDate: "1970-01-01" });
    const s = scoreReleaseGroup(c, "Radiohead", "Kid A", 2020);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("filterByTrackCount", () => {
  it("returns everything when the track count is unknown", () => {
    const cands = [candidate({ primaryType: "Single" }), candidate({ primaryType: "Album" })];
    expect(filterByTrackCount(cands, 0)).toEqual(cands);
  });

  it("allows Single and Album for a two-track release", () => {
    const kept = filterByTrackCount(
      [
        candidate({ id: "s", primaryType: "Single" }),
        candidate({ id: "a", primaryType: "Album" }),
        candidate({ id: "e", primaryType: "EP" }),
      ],
      2
    );
    expect(kept.map((c) => c.id)).toEqual(["s", "a"]);
  });

  it("allows EP and Album for a five-track release", () => {
    const kept = filterByTrackCount(
      [candidate({ id: "s", primaryType: "Single" }), candidate({ id: "e", primaryType: "EP" })],
      5
    );
    expect(kept.map((c) => c.id)).toEqual(["e"]);
  });

  it("keeps candidates with an unknown primary type at any track count", () => {
    const kept = filterByTrackCount([candidate({ id: "u", primaryType: null })], 12);
    expect(kept.map((c) => c.id)).toEqual(["u"]);
  });

  it("falls back to the unfiltered list rather than returning nothing", () => {
    const cands = [candidate({ id: "s", primaryType: "Single" })];
    expect(filterByTrackCount(cands, 12)).toEqual(cands);
  });
});

describe("rankCandidates", () => {
  it("puts the obvious right answer first", () => {
    const ranked = rankCandidates(
      [
        candidate({ id: "wrong", title: "Kid B", artistName: "Radiohead" }),
        candidate({ id: "right", title: "Kid A", artistName: "Radiohead" }),
      ],
      "Radiohead",
      "Kid A"
    );
    expect(ranked[0]!.candidate.id).toBe("right");
  });

  it("prefers Album over Single at an equal fuzzy score", () => {
    const ranked = rankCandidates(
      [
        candidate({ id: "single", primaryType: "Single", score: 100 }),
        candidate({ id: "album", primaryType: "Album", score: 100 }),
      ],
      "Some Artist",
      "Some Album"
    );
    expect(ranked[0]!.candidate.id).toBe("album");
  });

  it("falls back to MusicBrainz's own score at an equal type and fuzzy score", () => {
    const ranked = rankCandidates(
      [
        candidate({ id: "low", score: 40 }),
        candidate({ id: "high", score: 95 }),
      ],
      "Some Artist",
      "Some Album"
    );
    expect(ranked[0]!.candidate.id).toBe("high");
  });

  it("keeps input order for candidates identical on every tiebreaker", () => {
    const ranked = rankCandidates(
      [candidate({ id: "first" }), candidate({ id: "second" }), candidate({ id: "third" })],
      "Some Artist",
      "Some Album"
    );
    expect(ranked.map((r) => r.candidate.id)).toEqual(["first", "second", "third"]);
  });

  it("returns an empty array for no candidates", () => {
    expect(rankCandidates([], "a", "b")).toEqual([]);
  });
});
