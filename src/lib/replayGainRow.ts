import type { CurrentTrack } from "../features/playback/store/playerTypes";

export interface ReplayGainColumns {
  replay_gain_track_gain: number | null;
  replay_gain_track_peak: number | null;
  replay_gain_album_gain: number | null;
  replay_gain_album_peak: number | null;
}

/** Select list for a `tracks` table aliased `t`; every play path must read these. */
export const REPLAY_GAIN_COLUMNS =
  "t.replay_gain_track_gain, t.replay_gain_track_peak, t.replay_gain_album_gain, t.replay_gain_album_peak";

export function replayGainFromRow(row: ReplayGainColumns): CurrentTrack["replayGain"] {
  if (row.replay_gain_track_gain == null && row.replay_gain_album_gain == null) return null;
  return {
    trackGain: row.replay_gain_track_gain,
    trackPeak: row.replay_gain_track_peak,
    albumGain: row.replay_gain_album_gain,
    albumPeak: row.replay_gain_album_peak,
  };
}
