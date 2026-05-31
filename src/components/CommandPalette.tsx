import React, { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { House, Music, Users, ListMusic, Settings, List, Play, User } from "lucide-react";
import { useSearch } from "../hooks/useSearch";
import { getCoverArtUrl } from "../lib/navidrome";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow } from "../hooks/useAlbums";
import "./CommandPalette.css";

type View = "home" | "nowplaying" | "library" | "artists" | "playlists" | "tags" | "settings";

interface NavCommand {
  kind: "nav";
  id: string;
  label: string;
  icon: React.ReactNode;
  view: View;
}

interface AlbumResult {
  kind: "album";
  id: string;
  name: string;
  artist: string | null;
  artwork_url: string | null;
}

interface TrackResult {
  kind: "track";
  id: string;
  title: string;
  artist: string | null;
  album_name: string | null;
}

interface ArtistResult {
  kind: "artist";
  id: string;
  name: string;
  album_count: number;
}

type Item = NavCommand | AlbumResult | TrackResult | ArtistResult;

const NAV_COMMANDS: NavCommand[] = [
  { kind: "nav", id: "nav-home",      label: "Home",      icon: <House size={16} />,     view: "home" },
  { kind: "nav", id: "nav-library",   label: "Library",   icon: <Music size={16} />,     view: "library" },
  { kind: "nav", id: "nav-artists",   label: "Artists",   icon: <Users size={16} />,     view: "artists" },
  { kind: "nav", id: "nav-playlists", label: "Playlists", icon: <ListMusic size={16} />, view: "playlists" },
  { kind: "nav", id: "nav-queue",     label: "Queue",     icon: <List size={16} />,      view: "nowplaying" },
  { kind: "nav", id: "nav-settings",  label: "Settings",  icon: <Settings size={16} />,  view: "settings" },
];

const RESULTS_CAP = 5;

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
  onSelectAlbum: (album: AlbumRow) => void;
  onPlayTrack: (id: string) => void;
  serverWithCredential?: ServerWithCredential;
}

export function CommandPalette({ open, onClose, onNavigate, onSelectAlbum, onPlayTrack, serverWithCredential }: Props) {
  const [raw, setRaw] = useState("");
  const deferred = useDeferredValue(raw.trim());
  const inputRef = useRef<HTMLInputElement>(null);
  const [focusedIdx, setFocusedIdx] = useState(0);

  const { data: results } = useSearch(deferred);

  const searchAlbums: AlbumResult[] = deferred
    ? (results?.albums.slice(0, RESULTS_CAP).map((a) => ({ kind: "album" as const, id: a.id, name: a.name, artist: a.artist, artwork_url: a.artwork_url })) ?? [])
    : [];
  const searchTracks: TrackResult[] = deferred
    ? (results?.tracks.slice(0, RESULTS_CAP).map((t) => ({ kind: "track" as const, id: t.id, title: t.title, artist: t.artist, album_name: t.album_name })) ?? [])
    : [];
  const searchArtists: ArtistResult[] = deferred
    ? (results?.artists.slice(0, RESULTS_CAP).map((a) => ({ kind: "artist" as const, id: `artist-${a.name}`, name: a.name, album_count: a.album_count })) ?? [])
    : [];

  const items: Item[] = deferred
    ? [...searchAlbums, ...searchTracks, ...searchArtists]
    : NAV_COMMANDS;

  const albumOffset = 0;
  const trackOffset = searchAlbums.length;
  const artistOffset = searchAlbums.length + searchTracks.length;

  const activate = useCallback((item: Item) => {
    if (item.kind === "nav") {
      onNavigate(item.view);
    } else if (item.kind === "album") {
      onSelectAlbum({
        id: item.id,
        server_id: serverWithCredential?.server.id ?? "",
        name: item.name,
        artist: item.artist,
        year: null,
        artwork_url: item.artwork_url,
      });
      // onSelectAlbum already calls navigateTo("library") and closes the palette
    } else if (item.kind === "track") {
      onPlayTrack(item.id);
    } else if (item.kind === "artist") {
      onNavigate("artists");
    }
    onClose();
  }, [onNavigate, onSelectAlbum, onPlayTrack, onClose, serverWithCredential]);

  useEffect(() => {
    if (open) {
      setRaw("");
      setFocusedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => { setFocusedIdx(0); }, [deferred]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIdx((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[focusedIdx];
        if (item) activate(item);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, items, focusedIdx, activate, onClose]);

  if (!open) return null;

  const isEmpty = deferred && results && searchAlbums.length === 0 && searchTracks.length === 0 && searchArtists.length === 0;

  return (
    <div className="cp-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cp-modal" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cp-input-row">
          <input
            ref={inputRef}
            className="cp-input"
            placeholder="Search albums, tracks, artists…"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cp-esc-hint">esc</kbd>
        </div>

        <div className="cp-results">
          {!deferred && (
            <div className="cp-section">
              <p className="cp-section-label">Go to</p>
              <div className="cp-nav-grid">
                {NAV_COMMANDS.map((cmd, i) => (
                  <button
                    key={cmd.id}
                    className={`cp-nav-item${i === focusedIdx ? " cp-item--focused" : ""}`}
                    onMouseEnter={() => setFocusedIdx(i)}
                    onMouseDown={(e) => { e.preventDefault(); activate(cmd); }}
                  >
                    <span className="cp-nav-icon">{cmd.icon}</span>
                    <span className="cp-nav-label">{cmd.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {deferred && !results && (
            <p className="cp-empty">Searching…</p>
          )}

          {deferred && results && isEmpty && (
            <p className="cp-empty">No results for "{deferred}"</p>
          )}

          {deferred && results && searchAlbums.length > 0 && (
            <div className="cp-section">
              <p className="cp-section-label">Albums</p>
              {searchAlbums.map((album, i) => {
                const idx = albumOffset + i;
                const artUrl = serverWithCredential && album.artwork_url
                  ? getCoverArtUrl(serverWithCredential.server.url, serverWithCredential.server.username, serverWithCredential.credential, album.artwork_url, 48)
                  : null;
                return (
                  <button
                    key={album.id}
                    className={`cp-result-row${idx === focusedIdx ? " cp-item--focused" : ""}`}
                    onMouseEnter={() => setFocusedIdx(idx)}
                    onMouseDown={(e) => { e.preventDefault(); activate(album); }}
                  >
                    {artUrl
                      ? <img className="cp-art" src={artUrl} alt="" />
                      : <div className="cp-art cp-art--placeholder" />}
                    <span className="cp-result-primary">{album.name}</span>
                    {album.artist && <span className="cp-result-secondary">{album.artist}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {deferred && results && searchTracks.length > 0 && (
            <div className="cp-section">
              <p className="cp-section-label">Tracks</p>
              {searchTracks.map((track, i) => {
                const idx = trackOffset + i;
                return (
                  <button
                    key={track.id}
                    className={`cp-result-row${idx === focusedIdx ? " cp-item--focused" : ""}`}
                    onMouseEnter={() => setFocusedIdx(idx)}
                    onMouseDown={(e) => { e.preventDefault(); activate(track); }}
                  >
                    <div className="cp-track-icon"><Play size={14} /></div>
                    <span className="cp-result-primary">{track.title}</span>
                    <span className="cp-result-secondary">
                      {[track.artist, track.album_name].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {deferred && results && searchArtists.length > 0 && (
            <div className="cp-section">
              <p className="cp-section-label">Artists</p>
              {searchArtists.map((artist, i) => {
                const idx = artistOffset + i;
                return (
                  <button
                    key={artist.name}
                    className={`cp-result-row${idx === focusedIdx ? " cp-item--focused" : ""}`}
                    onMouseEnter={() => setFocusedIdx(idx)}
                    onMouseDown={(e) => { e.preventDefault(); activate(artist); }}
                  >
                    <div className="cp-track-icon"><User size={14} /></div>
                    <span className="cp-result-primary">{artist.name}</span>
                    <span className="cp-result-secondary">{artist.album_count} albums</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="cp-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
