import type { SearchAlbum, SearchArtist, SearchResults, SearchTrack } from "./useSearch";

// Double quotes are stripped to avoid breaking FTS5 syntax. Scoring must see the same
// tokens the index matched, or a doubled space or stray quote filters every hit back out.
export function toSearchTokens(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/"/g, ""));
}

const BRACKETED = /\(([^)]*)\)|\[([^\]]*)\]/g;
// Keeps a bracket-only exact match (100) under the lowest plain score, an artist substring (180).
const BRACKETED_DIVISOR = 10;

// Text in brackets ("(Expanded Edition)", "[Live]") still matches, but ranks below any match
// in the rest of the field.
function scoreMatch(field: string | null, query: string): number {
  if (!field || !query) return 0;
  const f = field.toLowerCase();
  const q = query.toLowerCase();
  const plain = f.replace(BRACKETED, " ").replace(/\s+/g, " ").trim();
  const bracketed = Array.from(f.matchAll(BRACKETED), (m) => m[1] ?? m[2] ?? "")
    .join(" ")
    .trim();
  if (!plain) return scoreTier(bracketed, q);
  const plainScore = scoreTier(plain, q);
  if (plainScore > 0) return plainScore;
  return Math.floor(scoreTier(bracketed, q) / BRACKETED_DIVISOR);
}

// Tiers: exact > starts-with > word-starts-with > substring > no match.
function scoreTier(f: string, q: string): number {
  if (f === q) return 1000;
  if (f.startsWith(q)) return 800;
  if (f.split(/\s+/).some((t) => t.startsWith(q))) return 600;
  if (f.includes(q)) return 300;
  return 0;
}

// A match on the artist of an album or track counts for less than one on its own name.
const ARTIST_FIELD_WEIGHT = 0.6;

export const albumScore = (album: Pick<SearchAlbum, "name" | "artist">, query: string) =>
  Math.max(scoreMatch(album.name, query), Math.floor(scoreMatch(album.artist, query) * ARTIST_FIELD_WEIGHT));

export const trackScore = (track: Pick<SearchTrack, "title" | "artist">, query: string) =>
  Math.max(scoreMatch(track.title, query), Math.floor(scoreMatch(track.artist, query) * ARTIST_FIELD_WEIGHT));

export const artistScore = (artist: Pick<SearchArtist, "name">, query: string) => scoreMatch(artist.name, query);

export type TopResult =
  | { kind: "artist"; artist: SearchArtist }
  | { kind: "album"; album: SearchAlbum }
  | { kind: "track"; track: SearchTrack };

/** The single best match across kinds. Each list is already sorted best first, so only its head
 * competes; a tie goes to the artist, then the album. */
export function pickTopResult(results: SearchResults, rawQuery: string): TopResult | null {
  const query = toSearchTokens(rawQuery).join(" ");
  const [artist] = results.artists;
  const [album] = results.albums;
  const [track] = results.tracks;
  const candidates: { result: TopResult; score: number }[] = [
    ...(artist ? [{ result: { kind: "artist" as const, artist }, score: artistScore(artist, query) }] : []),
    ...(album ? [{ result: { kind: "album" as const, album }, score: albumScore(album, query) }] : []),
    ...(track ? [{ result: { kind: "track" as const, track }, score: trackScore(track, query) }] : []),
  ];
  let best: { result: TopResult; score: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.score > 0 && (!best || candidate.score > best.score)) best = candidate;
  }
  return best?.result ?? null;
}
