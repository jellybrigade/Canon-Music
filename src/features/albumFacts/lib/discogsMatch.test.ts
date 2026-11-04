import { describe, expect, it } from "vitest";
import {
  type DiscogsRelease,
  type DiscogsSearchHit,
  discogsFacts,
  discogsName,
  isFittingRelease,
  pickDiscogsTarget,
} from "./discogsMatch";

const PISS = { name: "you made me / skin on linen", artist: "PISS", kind: "album" as const, trackCount: 15 };

function hit(overrides: Partial<DiscogsSearchHit>): DiscogsSearchHit {
  return {
    id: 1,
    masterId: null,
    artistName: "PISS",
    title: "you made me / skin on linen",
    year: 2026,
    ...overrides,
  };
}

function release(overrides: Partial<DiscogsRelease> = {}): DiscogsRelease {
  return {
    id: 38888610,
    artistNames: ["PISS"],
    title: "you made me / skin on linen",
    labels: [{ name: "Sub Pop", catalogNumber: "SP1753" }],
    country: "Canada",
    styles: ["Noise Rock", "Post-Hardcore"],
    genres: ["Rock"],
    trackCount: 15,
    formatDescriptions: ["Album"],
    ...overrides,
  };
}

describe("discogsName", () => {
  it("drops the number Discogs adds to tell same-named artists apart", () => {
    expect(discogsName("PISS (16)")).toBe("PISS");
  });

  it("drops the name-variation star", () => {
    expect(discogsName("Weatherday*")).toBe("Weatherday");
  });

  it("keeps brackets that are part of the name", () => {
    expect(discogsName("Sunn O)))")).toBe("Sunn O)))");
  });
});

describe("pickDiscogsTarget", () => {
  it("takes the master most matching pressings belong to", () => {
    const hits = [hit({ id: 10, masterId: 7 }), hit({ id: 11, masterId: 4391529 }), hit({ id: 12, masterId: 4391529 })];
    expect(pickDiscogsTarget(PISS, hits)).toEqual({ kind: "master", id: 4391529 });
  });

  it("breaks a tie between masters by the lower id", () => {
    const hits = [hit({ id: 10, masterId: 9 }), hit({ id: 11, masterId: 5 })];
    expect(pickDiscogsTarget(PISS, hits)).toEqual({ kind: "master", id: 5 });
  });

  it("takes the earliest release when none belongs to a master", () => {
    const hits = [hit({ id: 30, year: 2027 }), hit({ id: 40, year: 2026 }), hit({ id: 20, year: null })];
    expect(pickDiscogsTarget(PISS, hits)).toEqual({ kind: "release", id: 40 });
  });

  it("ignores hits whose artist or title differ", () => {
    const hits = [
      hit({ id: 1, masterId: 1, artistName: "P.I.S.S." }),
      hit({ id: 2, masterId: 2, title: "you made me / skin on linen (Deluxe)" }),
    ];
    expect(pickDiscogsTarget(PISS, hits)).toBeNull();
  });
});

describe("isFittingRelease", () => {
  it("accepts the same artist, title, kind and about the same track count", () => {
    expect(isFittingRelease(PISS, release({ trackCount: 14 }))).toBe(true);
  });

  it("rejects a release with clearly more tracks", () => {
    expect(isFittingRelease(PISS, release({ trackCount: 22 }))).toBe(false);
  });

  it("rejects a single of the same name", () => {
    expect(isFittingRelease(PISS, release({ formatDescriptions: ["Single"], trackCount: 15 }))).toBe(false);
  });

  it("skips the kind check when the formats name no kind", () => {
    expect(isFittingRelease(PISS, release({ formatDescriptions: ["Stereo"] }))).toBe(true);
  });

  it("matches the lead artist of a shared credit", () => {
    expect(isFittingRelease(PISS, release({ artistNames: ["PISS (16)", "Someone"] }))).toBe(true);
  });
});

describe("discogsFacts", () => {
  it("takes the first label with its catalog number", () => {
    expect(discogsFacts(release())).toEqual({
      label: "Sub Pop",
      catalogNumber: "SP1753",
      country: "Canada",
      styles: ["Noise Rock", "Post-Hardcore"],
      genres: ["Rock"],
    });
  });

  it("calls an unlabelled release self-released, without a catalog number", () => {
    const facts = discogsFacts(
      release({ labels: [{ name: "Not On Label (Weatherday Self-released)", catalogNumber: "none" }] }),
    );
    expect(facts.label).toBe("Self-released");
    expect(facts.catalogNumber).toBeNull();
  });

  it("drops the number Discogs adds to a same-named label", () => {
    expect(discogsFacts(release({ labels: [{ name: "Topshelf Records (2)", catalogNumber: "TS1" }] })).label).toBe(
      "Topshelf Records",
    );
  });

  it("drops an unknown country and a missing label", () => {
    const facts = discogsFacts(release({ labels: [], country: "Unknown" }));
    expect(facts).toMatchObject({ label: null, catalogNumber: null, country: null });
  });
});
