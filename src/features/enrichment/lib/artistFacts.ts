import { lookupArtist, type MbArtistDetail } from "../../../clients/musicbrainz";
import { fetchWikidataClaims, type WikidataClaims, type WikidataStatement } from "../../../clients/wikidata";

export interface ArtistFactValues {
  type: string | null;
  /** ISO 3166-1 alpha-2, or a MusicBrainz pseudo-code like "XW". */
  countryCode: string | null;
  beginYear: number | null;
}

export interface ArtistFacts extends ArtistFactValues {
  /** The sources that gave something, comma-separated ("musicbrainz,wikidata"); null when none did. */
  source: string | null;
}

// "Other" says nothing a reader can use.
const SHOWN_MB_TYPES = new Set(["Person", "Group", "Orchestra", "Choir", "Character"]);
const BORN_TYPES = new Set(["Person", "Character"]);
const WIKIDATA_HUMAN = "Q5";
const WIKIDATA_YEAR_PRECISION = 9;
const ISO_COUNTRY_CODE = /^[A-Z]{2}$/;

function yearOfDate(date: string | null): number | null {
  const year = /^(\d{4})/.exec(date ?? "")?.[1];
  return year === undefined ? null : Number(year);
}

function factsFromMusicBrainz(artist: MbArtistDetail): ArtistFactValues {
  return {
    type: artist.type && SHOWN_MB_TYPES.has(artist.type) ? artist.type : null,
    countryCode: artist.country,
    beginYear: yearOfDate(artist.lifeSpanBegin),
  };
}

/** Wikidata's own reading of a property: preferred statements if any, else normal ones; never deprecated. */
function bestValues(claims: WikidataClaims, property: string): unknown[] {
  const statements = (claims[property] ?? []).filter(
    (statement: WikidataStatement) => statement.mainsnak?.snaktype === "value" && statement.rank !== "deprecated",
  );
  const preferred = statements.filter((statement) => statement.rank === "preferred");
  return (preferred.length > 0 ? preferred : statements).map((statement) => statement.mainsnak?.datavalue?.value);
}

function itemIds(claims: WikidataClaims, property: string): string[] {
  const ids = bestValues(claims, property).flatMap((value) =>
    typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" ? [value.id] : [],
  );
  return [...new Set(ids)];
}

/** The one item a property names; several of equal rank (dual citizenship) leave it unknown. */
function singleItemId(claims: WikidataClaims, property: string): string | null {
  const ids = itemIds(claims, property);
  return ids.length === 1 ? (ids[0] ?? null) : null;
}

function year(claims: WikidataClaims, property: string): number | null {
  for (const value of bestValues(claims, property)) {
    if (typeof value !== "object" || value === null || !("time" in value) || typeof value.time !== "string") continue;
    const precision = "precision" in value && typeof value.precision === "number" ? value.precision : 0;
    if (precision < WIKIDATA_YEAR_PRECISION) continue;
    const parsed = /^\+(\d{4})-/.exec(value.time)?.[1] ?? /^\+(\d{4})$/.exec(value.time)?.[1];
    if (parsed) return Number(parsed);
  }
  return null;
}

function isoCode(claims: WikidataClaims): string | null {
  const codes = [...new Set(bestValues(claims, "P297").filter((value) => typeof value === "string"))];
  const code = codes.length === 1 ? codes[0] : undefined;
  return typeof code === "string" && ISO_COUNTRY_CODE.test(code) ? code : null;
}

function factsFromWikidata(claims: WikidataClaims): {
  type: string | null;
  countryItemId: string | null;
  beginYear: number | null;
} {
  const isPerson = itemIds(claims, "P31").includes(WIKIDATA_HUMAN);
  if (isPerson) return { type: "Person", countryItemId: singleItemId(claims, "P27"), beginYear: year(claims, "P569") };
  const beginYear = year(claims, "P571");
  return { type: beginYear !== null ? "Group" : null, countryItemId: singleItemId(claims, "P495"), beginYear };
}

function isComplete(facts: ArtistFactValues): boolean {
  return facts.type !== null && facts.countryCode !== null && facts.beginYear !== null;
}

function hasAny(facts: ArtistFactValues): boolean {
  return facts.type !== null || facts.countryCode !== null || facts.beginYear !== null;
}

/** An artist's type, country and birth or formation year: MusicBrainz first, Wikidata for what it lacks.
 *  Rejects when a source that was needed didn't answer, so stored facts aren't overwritten by a gap. */
export async function fetchArtistFacts(mbArtistId: string): Promise<ArtistFacts> {
  const artist = await lookupArtist(mbArtistId);
  const fromMusicBrainz = factsFromMusicBrainz(artist);
  const sources = hasAny(fromMusicBrainz) ? ["musicbrainz"] : [];
  if (isComplete(fromMusicBrainz) || !artist.wikidataId) {
    return { ...fromMusicBrainz, source: sources.join(",") || null };
  }

  const claims = await fetchWikidataClaims(artist.wikidataId);
  if (!claims) return { ...fromMusicBrainz, source: sources.join(",") || null };
  const fromWikidata = factsFromWikidata(claims);
  let wikidataCountry: string | null = null;
  if (!fromMusicBrainz.countryCode && fromWikidata.countryItemId) {
    const countryClaims = await fetchWikidataClaims(fromWikidata.countryItemId);
    wikidataCountry = countryClaims ? isoCode(countryClaims) : null;
  }

  const facts: ArtistFactValues = {
    type: fromMusicBrainz.type ?? fromWikidata.type,
    countryCode: fromMusicBrainz.countryCode ?? wikidataCountry,
    beginYear: fromMusicBrainz.beginYear ?? fromWikidata.beginYear,
  };
  const isWikidataUsed =
    (!fromMusicBrainz.type && !!fromWikidata.type) ||
    (!fromMusicBrainz.countryCode && !!wikidataCountry) ||
    (fromMusicBrainz.beginYear === null && fromWikidata.beginYear !== null);
  if (isWikidataUsed) sources.push("wikidata");
  return { ...facts, source: sources.join(",") || null };
}

export interface StoredArtistFactsRow {
  mb_artist_id: string | null;
  facts_mb_artist_id: string | null;
  artist_type: string | null;
  country_code: string | null;
  begin_year: number | null;
}

/** Stored facts, only while they were read for the artist's current MusicBrainz match. */
export function storedArtistFacts(row: StoredArtistFactsRow): ArtistFactValues | null {
  if (!row.mb_artist_id || row.facts_mb_artist_id !== row.mb_artist_id) return null;
  return { type: row.artist_type, countryCode: row.country_code, beginYear: row.begin_year };
}

function countryName(code: string): string | null {
  if (!ISO_COUNTRY_CODE.test(code)) return null;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    // Unassigned and pseudo-codes ("XW" for worldwide) come back as the code or "Unknown Region".
    return name && name !== code && name !== "Unknown Region" ? name : null;
  } catch {
    return null;
  }
}

/** "Group · United Kingdom · Formed 1991"; only what is known, null when nothing is. */
export function artistFactsLine(facts: ArtistFactValues): string | null {
  const country = facts.countryCode ? countryName(facts.countryCode) : null;
  let yearText: string | null = null;
  if (facts.type && facts.beginYear !== null) {
    yearText = `${BORN_TYPES.has(facts.type) ? "Born" : "Formed"} ${facts.beginYear}`;
  }
  const parts = [facts.type, country, yearText].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}
