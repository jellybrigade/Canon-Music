import { describe, expect, it } from "vitest";
import type { MbReleaseGroupCandidate } from "../../../clients/musicbrainz";
import {
  albumShapeOf,
  type LocalAlbum,
  normalizeForMatch,
  pickClearWinner,
  rankCandidates,
  scoreReleaseGroup,
  similarity,
  stripTrailingBrackets,
} from "./fuzzyMatch";

function candidate(over: Partial<MbReleaseGroupCandidate> = {}): MbReleaseGroupCandidate {
  return {
    id: over.id ?? "rg-1",
    title: over.title ?? "Some Album",
    artistName: over.artistName ?? "Some Artist",
    artistMbid: over.artistMbid ?? null,
    primaryType: over.primaryType === undefined ? "Album" : over.primaryType,
    secondaryTypes: over.secondaryTypes ?? [],
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

describe("stripTrailingBrackets", () => {
  it("strips a trailing parenthesized suffix", () => {
    expect(stripTrailingBrackets("Album (Deluxe Edition)")).toBe("Album");
  });

  it("strips a trailing bracketed suffix", () => {
    expect(stripTrailingBrackets("Album [Remastered]")).toBe("Album");
  });

  it("returns null when there is no trailing bracket group", () => {
    expect(stripTrailingBrackets("Album")).toBeNull();
  });

  it("returns null instead of an empty string when the whole title is the bracket group", () => {
    expect(stripTrailingBrackets("(Live)")).toBeNull();
  });

  it("does not strip a bracket group that isn't at the end of the string", () => {
    expect(stripTrailingBrackets("(Live) Album")).toBeNull();
  });

  it("strips from the first opening bracket through the end on multiple trailing groups", () => {
    // Lazy `.*?` still has to reach end-of-string, so it spans both groups, not just the last.
    expect(stripTrailingBrackets("Album (Live) [Remastered]")).toBe("Album");
  });

  it("strips a nested bracket group anchored at the end", () => {
    expect(stripTrailingBrackets("Album (Deluxe [2020] Edition)")).toBe("Album");
  });

  it("allows mismatched bracket/paren delimiters to still close the group", () => {
    expect(stripTrailingBrackets("Album (Live]")).toBe("Album");
  });

  it("returns null when brackets are mismatched but not at the true end", () => {
    expect(stripTrailingBrackets("Album (Live] mismatched")).toBeNull();
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
  const local = (over: Partial<LocalAlbum> = {}): LocalAlbum => ({
    artist: "Some Artist",
    title: "Some Album",
    ...over,
  });

  it("scores an exact artist and title match at 1", () => {
    const c = candidate({ title: "Kid A", artistName: "Radiohead" });
    expect(scoreReleaseGroup(c, local({ artist: "Radiohead", title: "Kid A" }))).toBe(1);
  });

  it("treats a collaboration credit as matching one of its members", () => {
    const c = candidate({ title: "Sun", artistName: "Filow & Ski Aggu" });
    expect(scoreReleaseGroup(c, local({ artist: "Filow", title: "Sun" }))).toBe(1);
  });

  it("scores a local title with a bracketed suffix close to the plain release", () => {
    const plain = candidate({ title: "BRAT", artistName: "Charli xcx" });
    expect(scoreReleaseGroup(plain, local({ artist: "Charli xcx", title: "BRAT (Dolby Atmos Mix)" }))).toBeGreaterThan(
      0.9,
    );
  });

  it("does not score a longer title that merely contains the local one like a match", () => {
    const c = candidate({ title: "Kid A Mnesia", artistName: "Radiohead" });
    expect(scoreReleaseGroup(c, local({ artist: "Radiohead", title: "Kid A" }))).toBeLessThan(0.8);
  });

  it("spreads containing titles by how much they add instead of pinning them all to one score", () => {
    const query = local({ artist: "Some Artist", title: "Night Drive" });
    const scores = [
      "Night Drive Remixed",
      "Night Drive and Other Short Stories",
      "Night Drive Sessions Volume Two",
    ].map((title) => scoreReleaseGroup(candidate({ title, secondaryTypes: [] }), query));
    expect(new Set(scores).size).toBe(3);
    expect(scores[0]).toBeGreaterThan(scores[1]!);
  });

  it("does not boost on a bare substring that is not a whole word", () => {
    const generic = candidate({ title: "Live", artistName: "Some Artist" });
    expect(scoreReleaseGroup(generic, local({ title: "Oliver Twist" }))).toBeLessThan(0.75);
  });

  it("does not count a name hidden inside another word as the same artist", () => {
    const c = candidate({ title: "Donda", artistName: "Kanye West" });
    expect(scoreReleaseGroup(c, local({ artist: "Ye", title: "Donda" }))).toBeLessThan(0.75);
  });

  it("does not treat a release crediting nobody as the searched artist", () => {
    const c = candidate({ title: "Kid A", artistName: "" });
    expect(scoreReleaseGroup(c, local({ artist: "Radiohead", title: "Kid A" }))).toBeLessThanOrEqual(0.6);
  });

  it("nudges an exact year match up and pulls a real year mismatch down", () => {
    const base = { title: "Sisterhood", artistName: "Some Artist" };
    const right = candidate({ ...base, firstReleaseDate: "2019-04-01" });
    const wrong = candidate({ ...base, firstReleaseDate: "1994-04-01", title: "Sisterhod" });
    const query = local({ title: "Sisterhood", year: 2019 });
    expect(scoreReleaseGroup(right, query)).toBeGreaterThan(scoreReleaseGroup(wrong, query));
  });

  it("does not punish a reissue year gap when the title matches closely", () => {
    const c = candidate({ title: "Kid A", artistName: "Radiohead", firstReleaseDate: "2000-10-02" });
    expect(scoreReleaseGroup(c, local({ artist: "Radiohead", title: "Kid A", year: 2016 }))).toBe(1);
  });

  it("overrides the artist component when the MBID is already confirmed", () => {
    const c = candidate({ title: "Kid A", artistName: "Completely Different Name", artistMbid: "mbid-1" });
    expect(scoreReleaseGroup(c, local({ artist: "Radiohead", title: "Kid A", confirmedArtistMbid: "mbid-1" }))).toBe(1);
  });

  it("does not dock a secondary type the local title names", () => {
    const live = candidate({ title: "Live at Wembley", artistName: "Queen", secondaryTypes: ["Live"] });
    expect(scoreReleaseGroup(live, local({ artist: "Queen", title: "Live at Wembley" }))).toBe(1);
    const hits = candidate({ title: "Greatest Hits", artistName: "Queen", secondaryTypes: ["Compilation"] });
    expect(scoreReleaseGroup(hits, local({ artist: "Queen", title: "Greatest Hits" }))).toBe(1);
  });

  it("docks a studio release when the local title says it is live", () => {
    const studio = candidate({ title: "Kid A", artistName: "Radiohead" });
    expect(scoreReleaseGroup(studio, local({ artist: "Radiohead", title: "Kid A (Live)" }))).toBeLessThan(0.85);
  });

  it("does not dock a studio release whose own title has the word live in it", () => {
    const studio = candidate({ title: "Live Through This", artistName: "Hole" });
    expect(scoreReleaseGroup(studio, local({ artist: "Hole", title: "Live Through This" }))).toBe(1);
  });

  it("clamps into 0..1", () => {
    const c = candidate({
      title: "zzzz",
      artistName: "qqqq",
      firstReleaseDate: "1970-01-01",
      secondaryTypes: ["Live"],
    });
    const s = scoreReleaseGroup(c, local({ artist: "Radiohead", title: "Kid A", year: 2020 }));
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("release shape", () => {
  const sameTitle = (primaryType: string | null) => candidate({ id: primaryType ?? "unknown", primaryType });
  const score = (primaryType: string | null, shape: Pick<LocalAlbum, "trackCount" | "durationSeconds">) =>
    scoreReleaseGroup(sameTitle(primaryType), { artist: "Some Artist", title: "Some Album", ...shape });
  const MINUTE = 60;

  it("docks a single against a three-track album running forty minutes", () => {
    const shape = { trackCount: 3, durationSeconds: 40 * MINUTE };
    expect(score("Album", shape)).toBe(1);
    expect(score("Album", shape) - score("Single", shape)).toBeGreaterThanOrEqual(0.1);
    expect(score("Album", shape) - score("EP", shape)).toBeGreaterThanOrEqual(0.1);
  });

  it("docks an album against two tracks running seven minutes", () => {
    const shape = { trackCount: 2, durationSeconds: 7 * MINUTE };
    expect(score("Single", shape)).toBe(1);
    expect(score("Single", shape) - score("Album", shape)).toBeGreaterThanOrEqual(0.1);
  });

  it("docks a single but not an EP against five short tracks", () => {
    const shape = { trackCount: 5, durationSeconds: 20 * MINUTE };
    expect(score("EP", shape)).toBe(1);
    expect(score("Album", shape)).toBe(1);
    expect(score("Single", shape)).toBeLessThan(0.9);
  });

  it("docks singles and EPs against twelve tracks", () => {
    const shape = { trackCount: 12, durationSeconds: 0 };
    expect(score("Album", shape)).toBe(1);
    expect(score("EP", shape)).toBeLessThan(0.9);
    expect(score("Single", shape)).toBeLessThan(0.9);
  });

  it("judges by track count alone when the length is unknown", () => {
    const shape = { trackCount: 2 };
    expect(score("Single", shape)).toBe(1);
    expect(score("Album", shape)).toBe(1);
  });

  it("docks nothing when the shape is unknown", () => {
    for (const primaryType of ["Single", "EP", "Album", "Broadcast", "Other", null]) {
      expect(score(primaryType, {}), String(primaryType)).toBe(1);
    }
  });

  it("never docks an unknown or catch-all release type", () => {
    const shape = { trackCount: 2, durationSeconds: 7 * MINUTE };
    expect(score(null, shape)).toBe(1);
    expect(score("Other", shape)).toBe(1);
  });
});

describe("albumShapeOf", () => {
  it("counts tracks and sums their length", () => {
    expect(albumShapeOf([{ duration: 600 }, { duration: 1800 }])).toEqual({ trackCount: 2, durationSeconds: 2400 });
  });

  it("reports the length as unknown when any track lacks one", () => {
    expect(albumShapeOf([{ duration: 600 }, { duration: null }])).toEqual({ trackCount: 2, durationSeconds: 0 });
  });

  it("reports an empty album as unknown", () => {
    expect(albumShapeOf([])).toEqual({ trackCount: 0, durationSeconds: 0 });
  });
});

describe("rankCandidates", () => {
  const query: LocalAlbum = { artist: "Some Artist", title: "Some Album" };

  it("puts the obvious right answer first", () => {
    const ranked = rankCandidates(
      [
        candidate({ id: "wrong", title: "Kid B", artistName: "Radiohead" }),
        candidate({ id: "right", title: "Kid A", artistName: "Radiohead" }),
      ],
      { artist: "Radiohead", title: "Kid A" },
    );
    expect(ranked[0]!.candidate.id).toBe("right");
  });

  it("prefers Album over Single at an equal fuzzy score", () => {
    const ranked = rankCandidates(
      [
        candidate({ id: "single", primaryType: "Single", score: 100 }),
        candidate({ id: "album", primaryType: "Album", score: 100 }),
      ],
      query,
    );
    expect(ranked[0]!.candidate.id).toBe("album");
  });

  it("falls back to MusicBrainz's own score at an equal type and fuzzy score", () => {
    const ranked = rankCandidates([candidate({ id: "low", score: 40 }), candidate({ id: "high", score: 95 })], query);
    expect(ranked[0]!.candidate.id).toBe("high");
  });

  it("keeps input order for candidates identical on every tiebreaker", () => {
    const ranked = rankCandidates(
      [candidate({ id: "first" }), candidate({ id: "second" }), candidate({ id: "third" })],
      query,
    );
    expect(ranked.map((r) => r.candidate.id)).toEqual(["first", "second", "third"]);
  });

  it("ranks a live, compilation or other secondary release the local title doesn't ask for below its plain rival", () => {
    const studio = candidate({ id: "studio", title: "Kid A", artistName: "Radiohead" });
    for (const secondaryType of ["Live", "Compilation", "Remix", "Demo", "Soundtrack", "DJ-mix", "Interview"]) {
      const other = candidate({
        id: "other",
        title: "Kid A",
        artistName: "Radiohead",
        secondaryTypes: [secondaryType],
      });
      const [top, second] = rankCandidates([other, studio], { artist: "Radiohead", title: "Kid A" });
      expect(top?.candidate.id, secondaryType).toBe("studio");
      expect(top!.score - second!.score, secondaryType).toBeGreaterThanOrEqual(0.1);
    }
  });

  it("does not dock a compilation or soundtrack with no plain rival", () => {
    for (const secondaryType of ["Compilation", "Soundtrack", "Live"]) {
      const only = candidate({ title: "Legend", artistName: "Bob Marley", secondaryTypes: [secondaryType] });
      const [top] = rankCandidates([only], { artist: "Bob Marley", title: "Legend" });
      expect(top?.score, secondaryType).toBe(1);
    }
  });

  it("does not dock a secondary type because a weaker rival lacks it", () => {
    const compilation = candidate({
      id: "hits",
      title: "Legend",
      artistName: "Bob Marley",
      secondaryTypes: ["Compilation"],
    });
    const unrelated = candidate({ id: "other", title: "Legend", artistName: "Someone Else" });
    const [top] = rankCandidates([compilation, unrelated], { artist: "Bob Marley", title: "Legend" });
    expect(top).toMatchObject({ candidate: { id: "hits" }, score: 1 });
  });

  it("returns an empty array for no candidates", () => {
    expect(rankCandidates([], { artist: "a", title: "b" })).toEqual([]);
  });
});

describe("pickClearWinner", () => {
  const rules = { minScore: 0.9, minGap: 0.1 };
  const ranked = (...entries: Array<[Partial<MbReleaseGroupCandidate>, number]>) =>
    entries.map(([over, score]) => ({ candidate: candidate(over), score }));

  it("picks a lone confident candidate", () => {
    expect(pickClearWinner(ranked([{ id: "album" }, 1]), rules)?.candidate.id).toBe("album");
  });

  it("picks an album tied with its own same-titled single", () => {
    const winner = pickClearWinner(
      ranked([{ id: "album", primaryType: "Album" }, 1], [{ id: "single", primaryType: "Single" }, 1]),
      rules,
    );
    expect(winner?.candidate.id).toBe("album");
  });

  it("refuses a near-tie between differently titled releases of different types", () => {
    expect(
      pickClearWinner(
        ranked(
          [{ id: "album", title: "Night Drive", primaryType: "Album" }, 0.95],
          [{ id: "ep", title: "Night Driver", primaryType: "EP" }, 0.9],
        ),
        rules,
      ),
    ).toBeNull();
  });

  it("refuses two tied candidates of the same type", () => {
    expect(
      pickClearWinner(ranked([{ id: "a", primaryType: "Album" }, 1], [{ id: "b", primaryType: "Album" }, 0.95]), rules),
    ).toBeNull();
  });

  it("refuses a top score under the threshold", () => {
    expect(pickClearWinner(ranked([{ id: "a" }, 0.89]), rules)).toBeNull();
  });

  it("picks a top candidate that clears the gap", () => {
    expect(pickClearWinner(ranked([{ id: "a" }, 1], [{ id: "b" }, 0.85]), rules)?.candidate.id).toBe("a");
  });

  it("returns null for no candidates", () => {
    expect(pickClearWinner([], rules)).toBeNull();
  });
});
