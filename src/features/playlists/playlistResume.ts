export interface ResumePoint {
  lastTrackId: string;
  trackPosition: number;
}

// The stored position goes stale whenever the playlist is edited or re-synced, so the
// track id decides; the position only picks between duplicates of that track.
export function resolveResumeIndex(tracks: readonly { id: string }[], resume: ResumePoint): number | null {
  let nearest: number | null = null;
  tracks.forEach((track, index) => {
    if (track.id !== resume.lastTrackId) return;
    if (nearest === null || Math.abs(index - resume.trackPosition) < Math.abs(nearest - resume.trackPosition)) {
      nearest = index;
    }
  });
  return nearest;
}
