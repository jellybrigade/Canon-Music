interface PlayedTrack {
  title: string;
  play_count: number | null;
  played_at: string | null;
}

/** The artist's tracks this server has actually played, most played first.
 *  Play counts are small integers, so ties are the normal case rather than an
 *  edge: the last-played stamp and then the title settle them, or two renders
 *  of the same data disagree. */
export function mostPlayedHere<T extends PlayedTrack>(tracks: T[], limit: number): T[] {
  return tracks
    .filter((t) => (t.play_count ?? 0) > 0)
    .sort((a, b) => {
      const byCount = (b.play_count ?? 0) - (a.play_count ?? 0);
      if (byCount !== 0) return byCount;
      const byRecency = (b.played_at ?? "").localeCompare(a.played_at ?? "");
      if (byRecency !== 0) return byRecency;
      return a.title.localeCompare(b.title);
    })
    .slice(0, limit);
}
