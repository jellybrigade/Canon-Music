import { useState, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Play, Trash2 } from "lucide-react";
import type { PlaylistRow } from "../hooks/usePlaylists";
import type { PlaylistTrackRow } from "../hooks/usePlaylistTracks";
import { usePlaylistTracks } from "../hooks/usePlaylistTracks";
import type { ServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl } from "../lib/navidrome";
import { makeStreamUrlBuilder } from "../lib/track";
import type { CurrentTrack } from "../store/player";
import { usePlayerStore } from "../store/player";
import { useGenreMappings, applyGenreMappings } from "../hooks/useGenreDisplay";

const SECONDS_PER_MINUTE = 60;
const PLAYLIST_ROW_HEIGHT = 40;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = seconds % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  playlist: PlaylistRow;
  serverWithCredential: ServerWithCredential;
  onClose: () => void;
  onDelete: () => Promise<void>;
}

export function PlaylistDetail({ playlist, serverWithCredential, onClose, onDelete }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: tracks, isLoading, removeTrack } = usePlaylistTracks(playlist.id);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const genreMappings = useGenreMappings();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: PlaylistTrackRow } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: tracks?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => PLAYLIST_ROW_HEIGHT,
    overscan: 5,
  });

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [contextMenu]);

  function buildTrackObj(track: PlaylistTrackRow): CurrentTrack {
    const coverArtUrl = track.artwork_url
      ? getCoverArtUrl(server.url, server.username, credential, track.artwork_url, 64)
      : null;
    return { id: track.id, title: track.title, artist: track.artist, duration: track.duration, coverArtUrl, artworkRef: track.artwork_url ?? null, album: track.album_name, albumId: track.album_id };
  }

  const streamUrlFor = makeStreamUrlBuilder(server, credential);

  function handlePlayTrack(track: PlaylistTrackRow) {
    if (!tracks) return;
    const startIndex = tracks.findIndex((t) => t.id === track.id && t.position === track.position);
    playQueue(tracks.map(buildTrackObj), streamUrlFor, startIndex >= 0 ? startIndex : 0);
  }

  function handlePlayAll() {
    if (!tracks || tracks.length === 0) return;
    playQueue(tracks.map(buildTrackObj), streamUrlFor, 0);
  }

  async function handleRemoveTrack(track: PlaylistTrackRow) {
    try {
      await removeTrack(track.position, playlist, serverWithCredential);
    } catch (e) {
      console.error("Failed to remove track from playlist:", e);
    }
    setContextMenu(null);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete();
    } catch (e) {
      console.error("Failed to delete playlist:", e);
      setDeleting(false);
    }
  }

  return (
    <div className="album-detail">
      <div className="album-detail-header">
        <button className="album-detail-back" onClick={onClose}>
          ← Playlists
        </button>
        <div className="album-detail-hero">
          <div className="album-detail-art album-art--placeholder" />
          <div className="album-detail-meta">
            <h2 className="album-detail-title">{playlist.name}</h2>
            {playlist.comment && <p className="album-detail-artist">{playlist.comment}</p>}
            <p className="album-detail-year">{playlist.track_count} {playlist.track_count === 1 ? "track" : "tracks"}</p>
            <div className="playlist-detail-actions">
              <button
                className="play-album-btn"
                onClick={handlePlayAll}
                disabled={!tracks || tracks.length === 0}
                aria-label="Play playlist"
              >
                <Play size={16} /> Play All
              </button>
              <button
                className="playlist-delete-btn"
                onClick={handleDelete}
                disabled={deleting}
                aria-label="Delete playlist"
                title="Delete playlist"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="album-detail-body" ref={scrollRef}>
        {isLoading ? (
          <p className="empty-state">Loading…</p>
        ) : !tracks || tracks.length === 0 ? (
          <p className="empty-state">Playlist is empty.</p>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const track = tracks[virtualItem.index]!;
              const isCurrentlyPlaying = currentTrack?.id === track.id && isPlaying;
              const isCurrentTrack = currentTrack?.id === track.id;
              return (
                <div
                  key={`${track.id}-${track.position}`}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  className={`playlist-vrow${isCurrentTrack ? " playlist-vrow--active" : ""}`}
                  onClick={() => handlePlayTrack(track)}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, track }); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && handlePlayTrack(track)}
                >
                  <span className="playlist-vrow-num">
                    {isCurrentlyPlaying
                      ? <span className="track-playing-indicator"><Play size={12} /></span>
                      : track.position + 1}
                  </span>
                  <span className="playlist-vrow-title">{track.title}</span>
                  <span className="playlist-vrow-artist">{track.artist ?? ""}</span>
                  <span className="playlist-vrow-genre">{applyGenreMappings(track.genre, genreMappings).join(", ")}</span>
                  <span className="playlist-vrow-duration">
                    {track.duration ? formatDuration(track.duration) : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { handlePlayTrack(contextMenu.track); setContextMenu(null); }}>
            Play Now
          </button>
          <button onClick={() => { playNext(buildTrackObj(contextMenu.track), streamUrlFor); setContextMenu(null); }}>
            Play Next
          </button>
          <button onClick={() => { addToQueue(buildTrackObj(contextMenu.track), streamUrlFor); setContextMenu(null); }}>
            Add to Queue
          </button>
          <button className="context-menu-danger" onClick={() => void handleRemoveTrack(contextMenu.track)}>
            Remove from Playlist
          </button>
        </div>
      )}
    </div>
  );
}
