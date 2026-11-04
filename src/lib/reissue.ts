import { lookedUpReissueSql } from "./releaseLookupSql";

const REISSUE_TITLE_WORDS = ["remaster", "reissue", "anniversary", "legacy edition"];

function yearOf(dateColumn: string): string {
  return `(CASE WHEN length(${dateColumn}) >= 4 THEN CAST(substr(${dateColumn}, 1, 4) AS INTEGER) END)`;
}

/** Holds when an album is a later edition of older music (rules: ARCHITECTURE `albums`).
 *  "Deluxe" alone is no evidence: a new album gets one in its own year. Never NULL, so `NOT`
 *  over it keeps undated albums. */
export function reissueSql(album: string, identity: string): string {
  const editionYears = [`${album}.year`, yearOf(`${album}.release_date`)];
  const earlierYears = [
    yearOf(`${album}.original_release_date`),
    yearOf(`${identity}.first_release_date`),
    yearOf(`${identity}.release_date`),
  ];
  const earlier = earlierYears.flatMap((earlierYear) => editionYears.map((year) => `${earlierYear} < ${year}`));
  // LIKE is case-insensitive for ASCII, and `(` / `[` are literal in it.
  const marked = REISSUE_TITLE_WORDS.flatMap((word) => [
    `${album}.name LIKE '%(%${word}%)%'`,
    `${album}.name LIKE '%[%${word}%]%'`,
  ]);
  return `((${[...earlier, ...marked, lookedUpReissueSql(album)].join(" OR ")}) IS 1)`;
}
