import type { MbArtistCandidate } from "../../../clients/musicbrainz";

export const ARTIST_AUTO_SELECT_SETTING = "mb.artist_auto_select_score";
export const DEFAULT_ARTIST_AUTO_SELECT_SCORE = 95;
const RIVAL_SCORE_MARGIN = 5;

/** Top MusicBrainz match if it clears `minScore` and no other match is within the rival margin. */
export function pickConfidentArtist(
  candidates: MbArtistCandidate[],
  minScore: number,
): MbArtistCandidate | null {
  const ranked = candidates
    .filter((c): c is MbArtistCandidate & { score: number } => c.score !== null)
    .sort((a, b) => b.score - a.score);
  const [top, runnerUp] = ranked;
  if (!top || top.score < minScore) return null;
  if (runnerUp && top.score - runnerUp.score <= RIVAL_SCORE_MARGIN) return null;
  return top;
}

export function parseArtistAutoSelectScore(raw: string): number {
  if (raw.trim() === "") return DEFAULT_ARTIST_AUTO_SELECT_SCORE;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_ARTIST_AUTO_SELECT_SCORE;
  return Math.min(100, Math.max(0, value));
}
