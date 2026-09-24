import { useEffect, useRef, useState } from "react";
import { Heart, Play, SlidersHorizontal } from "lucide-react";
import { useClickOutside } from "../../ui/useClickOutside";
import { useTrackListSessionStore } from "../../store/trackListSessionStore";
import type { TrackRow } from "../../types/library";
import { trackGenres, type TrackGenre } from "./albumGenres";
import "./AlbumTrackList.css";

const SECONDS_PER_MINUTE = 60;
const TRACK_SKELETON_ROWS = 8;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = seconds % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  tracks: TrackRow[] | undefined;
  isLoading: boolean;
  tracksError: string | null;
  missingTracks: { isFetching: boolean; error: string | null; retry: () => void };
  trackTagGenresMap: Map<string, TrackGenre[]>;
  genreMappings: Map<string, string | null>;
  currentTrackId: string | null;
  isPlaying: boolean;
  lovedTrackIds: Set<string>;
  onToggleLove: (trackId: string) => void;
  onPlayTrack: (track: TrackRow) => void;
  onContextMenu: (e: React.MouseEvent, track: TrackRow) => void;
}

function useTrackColumns() {
  const [trackCols, setTrackCols] = useState<{
    artist: boolean; genre: boolean; disc: boolean;
    duration: boolean; format: boolean; bitrate: boolean; plays: boolean;
  }>(() => {
    const defaults = { artist: true, genre: true, disc: false, duration: true, format: false, bitrate: false, plays: true };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem("canon-album-track-cols") ?? "null") }; }
    catch { return defaults; }
  });

  useEffect(() => {
    localStorage.setItem("canon-album-track-cols", JSON.stringify(trackCols));
  }, [trackCols]);

  return [trackCols, setTrackCols] as const;
}

export function AlbumTrackList({
  tracks,
  isLoading,
  tracksError,
  missingTracks,
  trackTagGenresMap,
  genreMappings,
  currentTrackId,
  isPlaying,
  lovedTrackIds,
  onToggleLove,
  onPlayTrack,
  onContextMenu,
}: Props) {
  const [trackCols, setTrackCols] = useTrackColumns();
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);
  useClickOutside(colPickerRef, () => setShowColPicker(false), showColPicker);

  if (isLoading) {
    return (
      <div className="album-track-skeleton" aria-label="Loading tracks" aria-busy="true">
        {Array.from({ length: TRACK_SKELETON_ROWS }, (_, i) => (
          <div key={i} className="album-track-skeleton-row">
            <span className="album-track-skeleton-bar album-track-skeleton-bar--num" />
            <span className="album-track-skeleton-bar" />
            <span className="album-track-skeleton-bar album-track-skeleton-bar--short" />
          </div>
        ))}
      </div>
    );
  }
  if (tracksError) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Couldn't load this album's tracks</p>
        <p className="empty-state-hint">{tracksError}</p>
        <button
          className="empty-state-action"
          onClick={() => useTrackListSessionStore.getState().bumpRefresh()}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!tracks || tracks.length === 0) {
    if (missingTracks.isFetching) {
      return (
        <div className="empty-state">
          <p className="empty-state-title">Getting this album's tracks</p>
          <p className="empty-state-hint">One moment, they will appear here ready to play.</p>
        </div>
      );
    }
    if (missingTracks.error) {
      return (
        <div className="empty-state">
          <p className="empty-state-title">Couldn't get this album's tracks</p>
          <p className="empty-state-hint">{missingTracks.error}</p>
          <button className="empty-state-action" onClick={missingTracks.retry}>Try again</button>
        </div>
      );
    }
    return (
      <div className="empty-state">
        <p className="empty-state-title">No tracks in this album</p>
        <p className="empty-state-hint">The server lists no tracks for it.</p>
        <button className="empty-state-action" onClick={missingTracks.retry}>Check again</button>
      </div>
    );
  }

  return (
    <div className="tracklist-wrapper">
      <div className="tracklist-col-picker-anchor" ref={colPickerRef}>
        <button
          className="tracklist-col-picker-btn"
          title="Show/hide columns"
          onClick={() => setShowColPicker((v) => !v)}
        >
          <SlidersHorizontal size={13} />
        </button>
        {showColPicker && (
          <div className="tracklist-col-picker-popup">
            {(
              [
                ["artist", "Artist"],
                ["genre", "Genre"],
                ["disc", "Disc #"],
                ["duration", "Duration"],
                ["format", "Format"],
                ["bitrate", "Bitrate"],
                ["plays", "Play count"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={trackCols[key]}
                  onChange={(e) => setTrackCols((c) => ({ ...c, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>
      <table className="tracklist">
        <tbody>
          {tracks.map((track) => {
            const isCurrentTrack = currentTrackId === track.id;
            const isCurrentlyPlaying = isCurrentTrack && isPlaying;
            const shownGenres = trackGenres(track, trackTagGenresMap, genreMappings).slice(0, 3);
            const isLoved = lovedTrackIds.has(track.id);
            return (
              <tr
                key={track.id}
                className={`tracklist-row tracklist-row--playable${isCurrentTrack ? " tracklist-row--active" : ""}`}
                onClick={() => onPlayTrack(track)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onContextMenu(e, track);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onPlayTrack(track)}
              >
                <td className="track-number">
                  {isCurrentlyPlaying ? (
                    <span className="track-playing-indicator">
                      <Play size={12} />
                    </span>
                  ) : (
                    track.track_number ?? "-"
                  )}
                </td>
                <td className="track-title">{track.title}</td>
                {trackCols.artist && <td className="track-artist">{track.artist ?? ""}</td>}
                {trackCols.genre && (
                  <td className="track-genre">
                    {shownGenres.map((g, i) => (
                      <span key={i} className="track-genre-chip">{g.display}</span>
                    ))}
                  </td>
                )}
                {trackCols.disc && <td className="track-disc">{track.disc_number ?? ""}</td>}
                {trackCols.duration && (
                  <td className="track-duration">
                    {track.duration ? formatDuration(track.duration) : ""}
                  </td>
                )}
                {trackCols.format && (
                  <td className="track-format">{track.suffix ? track.suffix.toUpperCase() : ""}</td>
                )}
                {trackCols.bitrate && (
                  <td className="track-bitrate">{track.bit_rate ? `${track.bit_rate}k` : ""}</td>
                )}
                {trackCols.plays && (
                  <td className="track-plays">{track.play_count ?? ""}</td>
                )}
                <td className="track-heart-cell">
                  <button
                    className={`track-heart${isLoved ? " track-heart--loved" : ""}`}
                    aria-label={isLoved ? "Unlove track" : "Love track"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLove(track.id);
                    }}
                  >
                    <Heart
                      size={15}
                      fill={isLoved ? "currentColor" : "none"}
                      strokeWidth={2}
                    />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
