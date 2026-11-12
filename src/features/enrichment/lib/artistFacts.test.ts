import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../clients/musicbrainz", () => ({ lookupArtist: vi.fn() }));
vi.mock("../../../clients/wikidata", () => ({ fetchWikidataClaims: vi.fn() }));

import { lookupArtist, type MbArtistDetail } from "../../../clients/musicbrainz";
import { fetchWikidataClaims, type WikidataClaims } from "../../../clients/wikidata";
import { artistFactsLine, fetchArtistFacts, storedArtistFacts } from "./artistFacts";

const MBID = "a74b1b7f-71a5-4011-9441-d0b5e4122711";

function mbArtist(fields: Partial<MbArtistDetail>): MbArtistDetail {
  return {
    id: MBID,
    name: "Radiohead",
    disambiguation: null,
    country: null,
    genres: [],
    type: null,
    lifeSpanBegin: null,
    wikidataId: null,
    ...fields,
  };
}

function item(id: string, rank = "normal") {
  return { rank, mainsnak: { snaktype: "value", datavalue: { value: { id } } } };
}

function time(text: string, precision = 9, rank = "normal") {
  return { rank, mainsnak: { snaktype: "value", datavalue: { value: { time: text, precision } } } };
}

function text(value: string) {
  return { rank: "normal", mainsnak: { snaktype: "value", datavalue: { value } } };
}

function claimsById(byId: Record<string, WikidataClaims>) {
  vi.mocked(fetchWikidataClaims).mockImplementation(async (id) => byId[id] ?? null);
}

afterEach(() => {
  vi.mocked(lookupArtist).mockReset();
  vi.mocked(fetchWikidataClaims).mockReset();
});

describe("fetchArtistFacts", () => {
  it("takes everything from MusicBrainz and asks Wikidata nothing when MusicBrainz knows it all", async () => {
    vi.mocked(lookupArtist).mockResolvedValue(
      mbArtist({ type: "Group", country: "GB", lifeSpanBegin: "1991", wikidataId: "Q44190" }),
    );

    await expect(fetchArtistFacts(MBID)).resolves.toEqual({
      type: "Group",
      countryCode: "GB",
      beginYear: 1991,
      source: "musicbrainz",
    });
    expect(fetchWikidataClaims).not.toHaveBeenCalled();
  });

  it("reads the year from a full date", async () => {
    vi.mocked(lookupArtist).mockResolvedValue(mbArtist({ type: "Person", country: "US", lifeSpanBegin: "1998-05-07" }));

    await expect(fetchArtistFacts(MBID)).resolves.toMatchObject({ beginYear: 1998 });
  });

  it("fills a group's missing country and year from Wikidata, MusicBrainz still winning what it has", async () => {
    vi.mocked(lookupArtist).mockResolvedValue(mbArtist({ type: "Group", wikidataId: "Q44190" }));
    claimsById({
      Q44190: { P31: [item("Q215380")], P495: [item("Q145")], P571: [time("+1985-00-00T00:00:00Z")] },
      Q145: { P297: [text("GB")] },
    });

    await expect(fetchArtistFacts(MBID)).resolves.toEqual({
      type: "Group",
      countryCode: "GB",
      beginYear: 1985,
      source: "musicbrainz,wikidata",
    });
  });

  it("reads a person's citizenship and birth year, and the type from instance of human", async () => {
    vi.mocked(lookupArtist).mockResolvedValue(mbArtist({ wikidataId: "Q1" }));
    claimsById({
      Q1: { P31: [item("Q5")], P27: [item("Q30")], P569: [time("+1998-05-07T00:00:00Z", 11)] },
      Q30: { P297: [text("US")] },
    });

    await expect(fetchArtistFacts(MBID)).resolves.toEqual({
      type: "Person",
      countryCode: "US",
      beginYear: 1998,
      source: "wikidata",
    });
  });

  it("names no country when a person holds several citizenships of equal rank", async () => {
    vi.mocked(lookupArtist).mockResolvedValue(mbArtist({ type: "Person", lifeSpanBegin: "1906", wikidataId: "Q1" }));
    claimsById({ Q1: { P31: [item("Q5")], P27: [item("Q183"), item("Q30")] } });

    await expect(fetchArtistFacts(MBID)).resolves.toMatchObject({ countryCode: null });
    expect(fetchWikidataClaims).toHaveBeenCalledTimes(1);
  });

  it("prefers a preferred-rank statement and ignores deprecated ones", async () => {
    vi.mocked(lookupArtist).mockResolvedValue(mbArtist({ type: "Group", country: "GB", wikidataId: "Q1" }));
    claimsById({ Q1: { P571: [time("+1980", 9, "deprecated"), time("+1985", 9), time("+1986", 9, "preferred")] } });

    await expect(fetchArtistFacts(MBID)).resolves.toMatchObject({ beginYear: 1986 });
  });

  it("ignores a year Wikidata knows only to the decade", async () => {
    vi.mocked(lookupArtist).mockResolvedValue(mbArtist({ type: "Group", country: "GB", wikidataId: "Q1" }));
    claimsById({ Q1: { P571: [time("+1980-00-00T00:00:00Z", 8)] } });

    await expect(fetchArtistFacts(MBID)).resolves.toMatchObject({ beginYear: null, source: "musicbrainz" });
  });

  it("drops MusicBrainz's catch-all type", async () => {
    vi.mocked(lookupArtist).mockResolvedValue(mbArtist({ type: "Other", country: "GB" }));

    await expect(fetchArtistFacts(MBID)).resolves.toMatchObject({ type: null });
  });

  it("answers with nothing when no source knows anything", async () => {
    vi.mocked(lookupArtist).mockResolvedValue(mbArtist({}));

    await expect(fetchArtistFacts(MBID)).resolves.toEqual({
      type: null,
      countryCode: null,
      beginYear: null,
      source: null,
    });
  });

  it("rejects when MusicBrainz didn't answer", async () => {
    vi.mocked(lookupArtist).mockRejectedValue(new Error("MusicBrainz returned 503"));

    await expect(fetchArtistFacts(MBID)).rejects.toThrow("503");
  });

  it("rejects when Wikidata was needed and didn't answer", async () => {
    vi.mocked(lookupArtist).mockResolvedValue(mbArtist({ type: "Group", wikidataId: "Q44190" }));
    vi.mocked(fetchWikidataClaims).mockRejectedValue(new Error("Wikidata returned 503"));

    await expect(fetchArtistFacts(MBID)).rejects.toThrow("503");
  });

  it("rejects when the country's own item didn't answer", async () => {
    vi.mocked(lookupArtist).mockResolvedValue(mbArtist({ type: "Group", lifeSpanBegin: "1991", wikidataId: "Q1" }));
    vi.mocked(fetchWikidataClaims).mockImplementation(async (id) => {
      if (id === "Q1") return { P495: [item("Q145")] };
      throw new Error("Wikidata returned 429");
    });

    await expect(fetchArtistFacts(MBID)).rejects.toThrow("429");
  });
});

describe("artistFactsLine", () => {
  it("names a group's country and the year it formed", () => {
    expect(artistFactsLine({ type: "Group", countryCode: "GB", beginYear: 1991 })).toBe(
      "Group · United Kingdom · Formed 1991",
    );
  });

  it("gives a person's birth year", () => {
    expect(artistFactsLine({ type: "Person", countryCode: "US", beginYear: 1998 })).toBe(
      "Person · United States · Born 1998",
    );
  });

  it("shows only what is known", () => {
    expect(artistFactsLine({ type: null, countryCode: "SE", beginYear: null })).toBe("Sweden");
  });

  it("leaves out a year it can't name without the type", () => {
    expect(artistFactsLine({ type: null, countryCode: null, beginYear: 1991 })).toBeNull();
  });

  it("leaves out a code that names no country", () => {
    expect(artistFactsLine({ type: "Group", countryCode: "XW", beginYear: null })).toBe("Group");
    expect(artistFactsLine({ type: "Group", countryCode: "nonsense", beginYear: null })).toBe("Group");
  });

  it("is empty with nothing known", () => {
    expect(artistFactsLine({ type: null, countryCode: null, beginYear: null })).toBeNull();
  });
});

describe("storedArtistFacts", () => {
  const row = {
    mb_artist_id: MBID,
    facts_mb_artist_id: MBID,
    artist_type: "Group",
    country_code: "GB",
    begin_year: 1991,
  };

  it("reads facts looked up for the artist's current match", () => {
    expect(storedArtistFacts(row)).toEqual({ type: "Group", countryCode: "GB", beginYear: 1991 });
  });

  it("drops facts read for an artist it is no longer matched to", () => {
    expect(storedArtistFacts({ ...row, mb_artist_id: "another" })).toBeNull();
    expect(storedArtistFacts({ ...row, mb_artist_id: null })).toBeNull();
  });
});
