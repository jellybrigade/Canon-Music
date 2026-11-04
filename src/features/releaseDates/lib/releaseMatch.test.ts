import { describe, expect, it } from "vitest";
import {
  type DeezerAlbumHit,
  decideRelease,
  isMatchingRelease,
  isSameArtist,
  isValidReleaseDate,
  type LocalRelease,
  localReleaseKind,
} from "./releaseMatch";

const PISS_ALBUM: LocalRelease = {
  name: "you made me / skin on linen",
  artist: "PISS",
  year: 2026,
  kind: "album",
  trackCount: 15,
};

// From the live search for the PISS album (2026-11-04).
const PISS_ALBUM_HIT: DeezerAlbumHit = {
  id: 1042239632,
  title: "you made me / skin on linen",
  recordType: "album",
  trackCount: 15,
  artistId: 419317862,
  artistName: "PISS",
};

function hit(overrides: Partial<DeezerAlbumHit>): DeezerAlbumHit {
  return { ...PISS_ALBUM_HIT, ...overrides };
}

describe("localReleaseKind", () => {
  it("reads the server's release type", () => {
    expect(localReleaseKind("single", 12)).toBe("single");
    expect(localReleaseKind("EP", 12)).toBe("ep");
    expect(localReleaseKind("live", 2)).toBe("album");
    expect(localReleaseKind("compilation", 2)).toBe("album");
    expect(localReleaseKind("soundtrack", 2)).toBe("album");
  });

  it("falls back to the track count when the type is missing or unknown", () => {
    expect(localReleaseKind(null, 1)).toBe("single");
    expect(localReleaseKind(null, 3)).toBe("single");
    expect(localReleaseKind("e", 5)).toBe("ep");
    expect(localReleaseKind(null, 7)).toBe("album");
  });

  it("knows nothing without a type or tracks", () => {
    expect(localReleaseKind(null, 0)).toBeNull();
  });
});

describe("isSameArtist", () => {
  it("ignores case and featured artists", () => {
    expect(isSameArtist("piss", "PISS")).toBe(true);
    expect(isSameArtist("PISS feat. Someone", "PISS")).toBe(true);
    expect(isSameArtist("PISS", "PISS ft. Someone")).toBe(true);
  });

  it("takes the lead artist of a pairing", () => {
    expect(isSameArtist("PISS & Friend", "PISS")).toBe(true);
  });

  it("keeps punctuation that makes another artist", () => {
    expect(isSameArtist("PISS", "P.I.S.S.")).toBe(false);
  });
});

describe("isMatchingRelease", () => {
  it("takes the same album", () => {
    expect(isMatchingRelease(PISS_ALBUM, PISS_ALBUM_HIT)).toBe(true);
  });

  it("never gives a single its album's date, or the reverse", () => {
    const single: LocalRelease = { ...PISS_ALBUM, name: "time loop at hot slit", kind: "single", trackCount: 1 };
    expect(
      isMatchingRelease(single, hit({ title: "time loop at hot slit", recordType: "album", trackCount: 15 })),
    ).toBe(false);
    expect(
      isMatchingRelease(single, hit({ title: "time loop at hot slit", recordType: "single", trackCount: 1 })),
    ).toBe(true);
    expect(isMatchingRelease(PISS_ALBUM, hit({ recordType: "single" }))).toBe(false);
  });

  it("treats a compilation record as an album", () => {
    expect(isMatchingRelease(PISS_ALBUM, hit({ recordType: "compile" }))).toBe(true);
  });

  it("keeps editions apart: a remaster is not the plain album", () => {
    const kindOfBlue: LocalRelease = {
      name: "Kind of Blue",
      artist: "Miles Davis",
      year: 2026,
      kind: "album",
      trackCount: 5,
    };
    const remaster = hit({ title: "Kind of Blue (Remastered)", artistName: "Miles Davis", trackCount: 5 });
    expect(isMatchingRelease(kindOfBlue, remaster)).toBe(false);
    expect(
      isMatchingRelease(
        { ...kindOfBlue, name: "Kind of Blue (Remastered)" },
        hit({ ...remaster, title: "Kind Of Blue" }),
      ),
    ).toBe(false);
    expect(isMatchingRelease(kindOfBlue, hit({ ...remaster, title: "Kind Of Blue" }))).toBe(true);
  });

  it("ignores quote style and accents", () => {
    const local: LocalRelease = {
      ...PISS_ALBUM,
      name: "blocking a scene you can't remember",
      kind: "single",
      trackCount: 1,
    };
    expect(
      isMatchingRelease(
        local,
        hit({ title: "Blocking a scene you can\u2019t rem\u00e9mber", recordType: "single", trackCount: 1 }),
      ),
    ).toBe(true);
  });

  it("rejects another artist of a similar name", () => {
    expect(isMatchingRelease(PISS_ALBUM, hit({ artistName: "P.I.S.S." }))).toBe(false);
  });

  it("rejects a track count more than two away", () => {
    expect(isMatchingRelease(PISS_ALBUM, hit({ trackCount: 17 }))).toBe(true);
    expect(isMatchingRelease(PISS_ALBUM, hit({ trackCount: 18 }))).toBe(false);
  });

  it("skips the count check when no local tracks are stored", () => {
    expect(isMatchingRelease({ ...PISS_ALBUM, trackCount: 0 }, hit({ trackCount: 30 }))).toBe(true);
  });
});

describe("isValidReleaseDate", () => {
  const latest = "2026-11-05";

  it("takes a full real date", () => {
    expect(isValidReleaseDate("2026-10-30", latest)).toBe(true);
    expect(isValidReleaseDate("2024-02-29", latest)).toBe(true);
  });

  it("rejects empty, partial or impossible dates", () => {
    expect(isValidReleaseDate("0000-00-00", latest)).toBe(false);
    expect(isValidReleaseDate("2026-10", latest)).toBe(false);
    expect(isValidReleaseDate("2026", latest)).toBe(false);
    expect(isValidReleaseDate("2026-02-30", latest)).toBe(false);
    expect(isValidReleaseDate("2026-13-01", latest)).toBe(false);
  });

  it("rejects a date past the latest allowed (pre-order or wrong data)", () => {
    expect(isValidReleaseDate("2026-11-05", latest)).toBe(true);
    expect(isValidReleaseDate("2026-11-06", latest)).toBe(false);
  });
});

describe("decideRelease", () => {
  const latest = "2026-11-05";

  it("takes the earliest valid date across matching editions", () => {
    const decision = decideRelease(
      PISS_ALBUM,
      [
        { releaseDate: "2026-11-01", label: "Clean Label", recordType: "album" },
        { releaseDate: "2026-10-30", label: "Sub Pop Records", recordType: "album" },
        { releaseDate: "0000-00-00", label: null, recordType: "album" },
      ],
      [],
      latest,
    );
    expect(decision).toEqual({
      releaseDate: "2026-10-30",
      label: "Sub Pop Records",
      recordType: "album",
      isReissue: false,
    });
  });

  it("finds nothing when no edition has a valid date", () => {
    expect(
      decideRelease(PISS_ALBUM, [{ releaseDate: "2027-01-01", label: null, recordType: "album" }], [], latest),
    ).toEqual({
      releaseDate: null,
      label: null,
      recordType: null,
      isReissue: false,
    });
  });

  it("marks an album whose own edition came out long before its tagged year a reissue", () => {
    const kindOfBlue: LocalRelease = {
      name: "Kind of Blue",
      artist: "Miles Davis",
      year: 2026,
      kind: "album",
      trackCount: 5,
    };
    const decision = decideRelease(
      kindOfBlue,
      [
        { releaseDate: "2021-05-01", label: "Columbia", recordType: "album" },
        { releaseDate: "2012-03-08", label: "Columbia", recordType: "album" },
      ],
      [],
      latest,
    );
    expect(decision.isReissue).toBe(true);
    expect(decision.releaseDate).toBe("2012-03-08");
  });

  it("marks an album a reissue when the artist put out an earlier edition under a bracketed title", () => {
    const kindOfBlue: LocalRelease = {
      name: "Kind of Blue",
      artist: "Miles Davis",
      year: 2026,
      kind: "album",
      trackCount: 5,
    };
    const decision = decideRelease(
      kindOfBlue,
      [],
      [{ title: "Kind of Blue (Remastered)", recordType: "album", releaseDate: "2019-07-26" }],
      latest,
    );
    expect(decision.isReissue).toBe(true);
  });

  it("does not count an earlier single of the same name as an earlier edition of the album", () => {
    const decision = decideRelease(
      { ...PISS_ALBUM, name: "time loop at hot slit" },
      [],
      [{ title: "time loop at hot slit", recordType: "single", releaseDate: "2024-09-02" }],
      latest,
    );
    expect(decision.isReissue).toBe(false);
  });

  it("does not call a late-December release tagged with the next year a reissue", () => {
    const decision = decideRelease(
      PISS_ALBUM,
      [{ releaseDate: "2025-12-12", label: null, recordType: "album" }],
      [{ title: "you made me / skin on linen (Deluxe)", recordType: "album", releaseDate: "2025-12-12" }],
      latest,
    );
    expect(decision.isReissue).toBe(false);
  });

  it("calls a deluxe edition of a record from well before the album's year a reissue", () => {
    const decision = decideRelease(
      { ...PISS_ALBUM, name: "you made me / skin on linen (Deluxe)" },
      [],
      [{ title: "you made me / skin on linen", recordType: "album", releaseDate: "2025-03-01" }],
      latest,
    );
    expect(decision.isReissue).toBe(true);
  });
});
