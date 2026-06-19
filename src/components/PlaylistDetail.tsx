import { useState, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Play, Trash2, Music, Pencil, Check, X } from "lucide-react";
import type { PlaylistRow } from "../hooks/usePlaylists";
import type { PlaylistTrackRow } from "../types/library";
import { usePlaylistTracks } from "../hooks/usePlaylistTracks";
import type { ServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl } from "../lib/navidrome";
import { makeStreamUrlBuilder } from "../lib/track";
import type { CurrentTrack } from "../store/player";
import { usePlayerStore } from "../store/player";
import { useGenreMappings, applyGenreMappings } from "../hooks/useGenreDisplay";
import "./AlbumDetail.css";
import "./PlaylistList.css";

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const PLAYLIST_ROW_HEIGHT = 40;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = seconds % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTotalDuration(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  if (totalMinutes < MINUTES_PER_HOUR) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const m = totalMinutes % MINUTES_PER_HOUR;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

interface Props {
  playlist: PlaylistRow;
  serverWithCredential: ServerWithCredential;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onRename: (playlist: PlaylistRow, name: string, comment: string | null, swc: ServerWithCredential) => Promise<void>;
}

export function PlaylistDetail({ playlist, serverWithCredential, onClose, onDelete, onRename }: Props) {
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(playlist.name);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState(playlist.comment ?? "");
  const [saving, setSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editingName) nameInputRef.current?.focus(); }, [editingName]);
  useEffect(() => { if (editingDesc) descInputRef.current?.focus(); }, [editingDesc]);

  // Reset local state when playlist changes
  useEffect(() => {
    setNameValue(playlist.name);
    setDescValue(playlist.comment ?? "");
  }, [playlist.id, playlist.name, playlist.comment]);

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

  async function commitName() {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === playlist.name) { setEditingName(false); setNameValue(playlist.name); return; }
    setSaving(true);
    try {
      await onRename(playlist, trimmed, playlist.comment, serverWithCredential);
    } catch (e) {
      console.error("Failed to rename playlist:", e);
      setNameValue(playlist.name);
    } finally {
      setSaving(false);
      setEditingName(false);
    }
  }

  async function commitDesc() {
    const trimmed = descValue.trim() || null;
    if (trimmed === playlist.comment) { setEditingDesc(false); return; }
    setSaving(true);
    try {
      await onRename(playlist, playlist.name, trimmed, serverWithCredential);
      setDescValue(trimmed ?? "");
    } catch (e) {
      console.error("Failed to update playlist description:", e);
      setDescValue(playlist.comment ?? "");
    } finally {
      setSaving(false);
      setEditingDesc(false);
    }
  }

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

  const totalSeconds = tracks?.reduce((sum, t) => sum + (t.duration ?? 0), 0) ?? 0;

  const coverArtUrl = playlist.cover_art_url
    ? getCoverArtUrl(server.url, server.username, credential, playlist.cover_art_url, 300)
    : null;

  return (
    <div className="album-detail">
      <div className="album-detail-header">
        <button className="album-detail-back" onClick={onClose}>
          ← Playlists
        </button>
        <div className="album-detail-hero">
          <div className="album-detail-art">
            {coverArtUrl ? (
              <img
                src={coverArtUrl}
                alt={playlist.name}
                className="album-detail-art-img"
                draggable={false}
              />
            ) : (
              <div className="album-detail-art album-art--placeholder playlist-art-placeholder">
                <Music size={40} />
              </div>
            )}
          </div>
          <div className="album-detail-meta">
            <div className="playlist-name-row">
              {editingName ? (
                <div className="playlist-inline-edit">
                  <input
                    ref={nameInputRef}
                    className="playlist-inline-input playlist-inline-input--name"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitName();
                      if (e.key === "Escape") { setEditingName(false); setNameValue(playlist.name); }
                    }}
                    disabled={saving}
                  />
                  <button className="playlist-inline-btn" onClick={() => void commitName()} disabled={saving} title="Save"><Check size={14} /></button>
                  <button className="playlist-inline-btn" onClick={() => { setEditingName(false); setNameValue(playlist.name); }} title="Cancel"><X size={14} /></button>
                </div>
              ) : (
                <h2 className="album-detail-title playlist-editable-title" onClick={() => setEditingName(true)} title="Click to rename">
                  {playlist.name}
                  <Pencil size={13} className="playlist-edit-icon" />
                </h2>
              )}
            </div>

            {editingDesc ? (
              <div className="playlist-inline-edit">
                <input
                  ref={descInputRef}
                  className="playlist-inline-input playlist-inline-input--desc"
                  value={descValue}
                  placeholder="Add description…"
                  onChange={(e) => setDescValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitDesc();
                    if (e.key === "Escape") { setEditingDesc(false); setDescValue(playlist.comment ?? ""); }
                  }}
                  disabled={saving}
                />
                <button className="playlist-inline-btn" onClick={() => void commitDesc()} disabled={saving} title="Save"><Check size={14} /></button>
                <button className="playlist-inline-btn" onClick={() => { setEditingDesc(false); setDescValue(playlist.comment ?? ""); }} title="Cancel"><X size={14} /></button>
              </div>
            ) : (
              <p
                className={`album-detail-artist playlist-editable-desc${!playlist.comment ? " playlist-editable-desc--empty" : ""}`}
                onClick={() => setEditingDesc(true)}
                title="Click to edit description"
              >
                {playlist.comment ?? "Add description…"}
                <Pencil size={11} className="playlist-edit-icon" />
              </p>
            )}

            <p className="album-detail-year">
              {playlist.track_count} {playlist.track_count === 1 ? "track" : "tracks"}
              {totalSeconds > 0 && ` · ${formatTotalDuration(totalSeconds)}`}
            </p>
            <div className="playlist-detail-actions">
              <button
                className="play-album-btn"
                onClick={handlePlayAll}
                disabled={!tracks || tracks.length === 0}
                aria-label="Play playlist"
              >
                <Play size={16} /> Play All
              </button>
              {confirmDelete ? (
                <>
                  <button
                    className="playlist-delete-btn playlist-delete-btn--confirm"
                    onClick={handleDelete}
                    disabled={deleting}
                    aria-label="Confirm delete"
                  >
                    {deleting ? "Deleting…" : "Delete?"}
                  </button>
                  <button
                    className="playlist-inline-btn"
                    onClick={() => setConfirmDelete(false)}
                    title="Cancel"
                  >
                    <X size={14} />
                  </button>
                </>
              ) : (
                <button
                  className="playlist-delete-btn"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete playlist"
                  title="Delete playlist"
                >
                  <Trash2 size={16} />
                </button>
              )}
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
