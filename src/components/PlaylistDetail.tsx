import { useState, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Play, Trash2, Music, Pencil, Check, X, SlidersHorizontal, Camera } from "lucide-react";
import type { PlaylistRow } from "../hooks/usePlaylists";
import type { PlaylistTrackRow } from "../types/library";
import { usePlaylistTracks } from "../hooks/usePlaylistTracks";
import type { ServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl } from "../lib/navidrome";
import { makeStreamUrlBuilder } from "../lib/track";
import type { CurrentTrack } from "../store/player";
import { usePlayerStore } from "../store/player";
import { useGenreMappings, applyGenreMappings } from "../hooks/useGenreDisplay";
import { getDb } from "../db";
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
  onSetCustomCover?: (playlistId: string, dataUri: string | null) => Promise<void>;
  onSelectAlbum?: (albumId: string) => void;
  onSelectArtist?: (artistName: string) => void;
}

export function PlaylistDetail({ playlist, serverWithCredential, onClose, onDelete, onRename, onSetCustomCover, onSelectAlbum, onSelectArtist }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: tracks, isLoading, removeTrack } = usePlaylistTracks(playlist.id);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const genreMappings = useGenreMappings();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: PlaylistTrackRow } | null>(null);

  const [playlistCols, setPlaylistCols] = useState<{
    artist: boolean; genre: boolean; album: boolean; year: boolean;
    duration: boolean; format: boolean; bitrate: boolean;
  }>(() => {
    const defaults = { artist: true, genre: true, album: false, year: false, duration: true, format: false, bitrate: false };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem("canon-playlist-cols") ?? "null") }; }
    catch { return defaults; }
  });
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("canon-playlist-cols", JSON.stringify(playlistCols));
  }, [playlistCols]);

  useEffect(() => {
    if (!showColPicker) return;
    const close = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) setShowColPicker(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showColPicker]);
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
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editingName) nameInputRef.current?.focus(); }, [editingName]);
  useEffect(() => { if (editingDesc) descInputRef.current?.focus(); }, [editingDesc]);

  // Reset local state when playlist changes
  useEffect(() => {
    setNameValue(playlist.name);
    setDescValue(playlist.comment ?? "");
  }, [playlist.id, playlist.name, playlist.comment]);

  const [resumeIndex, setResumeIndex] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDb().then(async (db) => {
      type Row = { last_track_id: string; track_position: number };
      const rows = await db.select<Row[]>(
        "SELECT last_track_id, track_position FROM playlist_resume WHERE playlist_id = ?",
        [playlist.id]
      );
      if (!cancelled && rows[0]) setResumeIndex(rows[0].track_position);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [playlist.id]);

  const virtualizer = useVirtualizer({
    count: tracks?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => PLAYLIST_ROW_HEIGHT,
    overscan: 5,
  });

  useEffect(() => {
    if (resumeIndex !== null && tracks && resumeIndex < tracks.length) {
      virtualizer.scrollToIndex(resumeIndex, { align: "start" });
    }
  }, [resumeIndex, tracks]);

  const gridTemplate = [
    "2.5rem",
    "minmax(0, 2fr)",
    playlistCols.artist ? "minmax(0, 1.25fr)" : null,
    playlistCols.genre ? "minmax(0, 1fr)" : null,
    playlistCols.album ? "minmax(0, 1fr)" : null,
    playlistCols.year ? "3.5rem" : null,
    playlistCols.format ? "3.5rem" : null,
    playlistCols.bitrate ? "4.5rem" : null,
    playlistCols.duration ? "auto" : null,
  ].filter(Boolean).join(" ");

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
    const idx = startIndex >= 0 ? startIndex : 0;
    playQueue(tracks.map(buildTrackObj), streamUrlFor, idx);
    getDb().then(async (db) => {
      await db.execute(
        `INSERT INTO playlist_resume (playlist_id, last_track_id, track_position, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(playlist_id) DO UPDATE SET last_track_id=excluded.last_track_id, track_position=excluded.track_position, updated_at=excluded.updated_at`,
        [playlist.id, track.id, idx]
      );
    }).catch(() => {});
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

  function handleCoverPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onSetCustomCover) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      void onSetCustomCover(playlist.id, dataUri);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  const displayCoverUrl = playlist.custom_cover_data
    ?? (playlist.cover_art_url
      ? getCoverArtUrl(server.url, server.username, credential, playlist.cover_art_url, 300)
      : null);

  return (
    <div className="album-detail">
      <div className="album-detail-header">
        <button className="album-detail-back" onClick={onClose}>
          ← Playlists
        </button>
        <div className="album-detail-hero">
          <div className="album-detail-art playlist-art-wrapper">
            {displayCoverUrl ? (
              <img
                src={displayCoverUrl}
                alt={playlist.name}
                className="album-detail-art-img"
                draggable={false}
              />
            ) : (
              <div className="album-detail-art album-art--placeholder playlist-art-placeholder">
                <Music size={40} />
              </div>
            )}
            {onSetCustomCover && (
              <div className="playlist-cover-overlay">
                <button
                  className="playlist-cover-pick-btn"
                  onClick={() => coverInputRef.current?.click()}
                  title="Set custom cover image"
                >
                  <Camera size={14} />
                </button>
                {playlist.custom_cover_data && (
                  <button
                    className="playlist-cover-remove-btn"
                    onClick={() => void onSetCustomCover(playlist.id, null)}
                    title="Remove custom cover"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleCoverPick}
            />
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

      <div className="playlist-list-controls">
        <div className="playlist-col-header" style={{ gridTemplateColumns: gridTemplate }}>
          <span className="playlist-col-header-cell">#</span>
          <span className="playlist-col-header-cell">Title</span>
          {playlistCols.artist && <span className="playlist-col-header-cell">Artist</span>}
          {playlistCols.genre && <span className="playlist-col-header-cell">Genre</span>}
          {playlistCols.album && <span className="playlist-col-header-cell">Album</span>}
          {playlistCols.year && <span className="playlist-col-header-cell">Year</span>}
          {playlistCols.format && <span className="playlist-col-header-cell">Format</span>}
          {playlistCols.bitrate && <span className="playlist-col-header-cell">Bitrate</span>}
          {playlistCols.duration && <span className="playlist-col-header-cell playlist-col-header-cell--right">Duration</span>}
        </div>
        <div className="tracklist-col-picker-anchor" ref={colPickerRef}>
          <button
            className="tracklist-col-picker-btn"
            title="Show/hide columns"
            onClick={() => setShowColPicker((v) => !v)}
          >
            <SlidersHorizontal size={13} />
          </button>
          {showColPicker && (
            <div className="tracklist-col-picker-popup tracklist-col-picker-popup--left">
              {(
                [
                  ["artist", "Artist"],
                  ["genre", "Genre"],
                  ["album", "Album"],
                  ["year", "Year"],
                  ["duration", "Duration"],
                  ["format", "Format"],
                  ["bitrate", "Bitrate"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={playlistCols[key]}
                    onChange={(e) => setPlaylistCols((c) => ({ ...c, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
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
                    gridTemplateColumns: gridTemplate,
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
                  {playlistCols.artist && <span className="playlist-vrow-artist">{track.artist ?? ""}</span>}
                  {playlistCols.genre && <span className="playlist-vrow-genre">{applyGenreMappings(track.genre, genreMappings).join(", ")}</span>}
                  {playlistCols.album && <span className="playlist-vrow-album">{track.album_name ?? ""}</span>}
                  {playlistCols.year && <span className="playlist-vrow-year">{track.year ?? ""}</span>}
                  {playlistCols.format && <span className="playlist-vrow-format">{track.suffix ? track.suffix.toUpperCase() : ""}</span>}
                  {playlistCols.bitrate && <span className="playlist-vrow-bitrate">{track.bit_rate ? `${track.bit_rate}k` : ""}</span>}
                  {playlistCols.duration && <span className="playlist-vrow-duration">
                    {track.duration ? formatDuration(track.duration) : ""}
                  </span>}
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
          {onSelectAlbum && contextMenu.track.album_id && (
            <button onClick={() => { onSelectAlbum(contextMenu.track.album_id!); setContextMenu(null); }}>
              Go to Album
            </button>
          )}
          {onSelectArtist && contextMenu.track.artist && (
            <button onClick={() => { onSelectArtist(contextMenu.track.artist!); setContextMenu(null); }}>
              Go to Artist
            </button>
          )}
          <button className="context-menu-danger" onClick={() => void handleRemoveTrack(contextMenu.track)}>
            Remove from Playlist
          </button>
        </div>
      )}
    </div>
  );
}
