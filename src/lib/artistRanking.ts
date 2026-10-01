interface PlayedTrack {
  title: string;
  play_count: number | null;
  played_at: string | null;
}

/** Most played first. Play counts are small integers, so ties are common; last-played then title settle them. */
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
