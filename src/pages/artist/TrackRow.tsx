import { memo } from "react";
import { Play } from "lucide-react";
import type { Server } from "../../types/server";
import type { NavidromeCredential } from "../../clients/navidromeUrls";
import type { CurrentTrack } from "../../features/playback/store/playerTypes";
import { getCoverArtUrl } from "../../clients/navidromeUrls";
import type { TopTrack } from "./artistQueries";

const SECONDS_PER_MINUTE = 60;

function formatDuration(seconds: number | null): string {
  if (!seconds) return "-";
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = seconds % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface TrackRowProps {
  track: TopTrack;
  rank: number;
  currentTrack: CurrentTrack | null;
  isPlaying: boolean;
  server: Server;
  credential: NavidromeCredential;
  onPlay: (track: TopTrack) => void;
  lastfmPlaycount?: number;
  lastfmCombined?: boolean;
  onAlbumClick?: (albumId: string) => void;
  onContextMenu?: (e: React.MouseEvent, track: TopTrack) => void;
}

export const TrackRow = memo(function TrackRow({ track, rank, currentTrack, isPlaying, server, credential, onPlay, lastfmPlaycount, lastfmCombined, onAlbumClick, onContextMenu }: TrackRowProps) {
  const isCurrentlyPlaying = currentTrack?.id === track.id && isPlaying;
  const isActive = currentTrack?.id === track.id;
  const artUrl = track.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, track.artwork_url, 64)
    : null;

  const showPlaycount = lastfmPlaycount !== undefined && lastfmPlaycount > 0;
  const showLibraryCount = !showPlaycount && track.play_count != null && track.play_count > 0;

  return (
    <div
      className={`artist-track-row${isActive ? " artist-track-row--active" : ""}`}
      onClick={() => onPlay(track)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e, track); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onPlay(track)}
    >
      <span className="artist-track-num">
        {isCurrentlyPlaying ? (
          <Play size={11} className="artist-track-playing-indicator" />
        ) : rank >= 0 ? (
          rank + 1
        ) : (
          <span className="artist-track-heart">♥</span>
        )}
      </span>
      {artUrl ? (
        <img className="artist-track-art" src={artUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="artist-track-art artist-track-art--placeholder" />
      )}
      <div className="artist-track-info">
        <span className="artist-track-title">{track.title}</span>
        {track.album_name && track.album_id && onAlbumClick ? (
          <button
            className="artist-track-album-link"
            onClick={(e) => { e.stopPropagation(); onAlbumClick(track.album_id!); }}
          >
            {track.album_name}
          </button>
        ) : track.album_name ? (
          <span className="artist-track-album">{track.album_name}</span>
        ) : null}
      </div>
      {showPlaycount ? (
        <span
          className="artist-track-playcount"
          title={lastfmCombined ? `Combined across multiple tracks named "${track.title}" by ${track.artist ?? "this artist"}` : undefined}
        >
          {formatCount(lastfmPlaycount!)} plays{lastfmCombined ? " · combined" : ""}
        </span>
      ) : showLibraryCount ? (
        <span className="artist-track-playcount">{track.play_count}×</span>
      ) : (
        <span className="artist-track-duration">{formatDuration(track.duration)}</span>
      )}
    </div>
  );
});
