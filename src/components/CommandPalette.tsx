import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAlbumDisplayName } from "../hooks/useAlbumDisplayName";
import { House, Music, Users, ListMusic, Settings, List, Play, User } from "lucide-react";
import { useSearch } from "../hooks/useSearch";
import { getCoverArtUrl } from "../lib/navidrome";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow } from "../types/library";
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
  server_id: string;
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

// Ids are unique inside a kind but not across them, and an album and a track can carry the
// same native id on some servers.
const itemKey = (item: Item) => `${item.kind}:${item.id}`;

const NAV_COMMANDS: NavCommand[] = [
  { kind: "nav", id: "nav-home",      label: "Home",      icon: <House size={16} />,     view: "home" },
  { kind: "nav", id: "nav-library",   label: "Library",   icon: <Music size={16} />,     view: "library" },
  { kind: "nav", id: "nav-artists",   label: "Artists",   icon: <Users size={16} />,     view: "artists" },
  { kind: "nav", id: "nav-playlists", label: "Playlists", icon: <ListMusic size={16} />, view: "playlists" },
  { kind: "nav", id: "nav-queue",     label: "Queue",     icon: <List size={16} />,      view: "nowplaying" },
  { kind: "nav", id: "nav-settings",  label: "Settings",  icon: <Settings size={16} />,  view: "settings" },
];

const RESULTS_CAP = 5;

// useDeferredValue only defers rendering - it still fires one search per
// keystroke. A real debounce keeps typing from queuing an FTS scan per character.
const SEARCH_DEBOUNCE_MS = 150;

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist: (name: string, albumCount: number) => void;
  onPlayTrack: (id: string) => void;
  serverWithCredential?: ServerWithCredential;
  serverId?: string;
}

export function CommandPalette({ open, onClose, onNavigate, onSelectAlbum, onSelectArtist, onPlayTrack, serverWithCredential, serverId }: Props) {
  const albumDisplayName = useAlbumDisplayName();
  const [raw, setRaw] = useState("");
  const [deferred, setDeferred] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef<HTMLButtonElement>(null);
  // The focused row is held by identity, not by position. `items` is rebuilt whenever results
  // arrive - later than the query that asked for them, and again on a server switch that never
  // touches the typed query - so a stored index means the highlight silently lands on whatever
  // row inherited that ordinal, and Enter opens it.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const trimmedRaw = raw.trim();
  useEffect(() => {
    const t = setTimeout(() => setDeferred(trimmedRaw), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmedRaw]);

  const { data: results, isError } = useSearch(deferred, serverId ?? serverWithCredential?.server.id);

  const searchAlbums: AlbumResult[] = deferred
    ? (results?.albums.slice(0, RESULTS_CAP).map((a) => ({ kind: "album" as const, id: a.id, server_id: a.server_id, name: a.name, artist: a.artist, artwork_url: a.artwork_url })) ?? [])
    : [];
  const searchTracks: TrackResult[] = deferred
    ? (results?.tracks.slice(0, RESULTS_CAP).map((t) => ({ kind: "track" as const, id: t.id, title: t.title, artist: t.artist, album_name: t.album_name })) ?? [])
    : [];
  const searchArtists: ArtistResult[] = deferred
    ? (results?.artists.slice(0, RESULTS_CAP).map((a) => ({ kind: "artist" as const, id: `artist-${a.name}`, name: a.name, album_count: a.album_count })) ?? [])
    : [];

  const items: Item[] = deferred
    ? [...searchArtists, ...searchAlbums, ...searchTracks]
    : NAV_COMMANDS;

  // Nothing focused, or a row that has since gone: the first row, which is what a freshly
  // arrived result set should offer Enter.
  const focusedIdx = Math.max(0, items.findIndex((item) => itemKey(item) === focusedKey));

  const artistOffset = 0;
  const albumOffset = searchArtists.length;
  const trackOffset = searchArtists.length + searchAlbums.length;

  const activate = useCallback((item: Item) => {
    if (item.kind === "nav") {
      onNavigate(item.view);
    } else if (item.kind === "album") {
      onSelectAlbum({
        id: item.id,
        // From the row, never the selected server: stamping the current
        // selection onto a row is what silently builds URLs against the
        // wrong host (see known-issues.md).
        server_id: item.server_id,
        name: item.name,
        artist: item.artist,
        year: null,
        artwork_url: item.artwork_url,
      });
    } else if (item.kind === "track") {
      onPlayTrack(item.id);
    } else if (item.kind === "artist") {
      onSelectArtist(item.name, item.album_count);
    }
    onClose();
    // No serverWithCredential dep: the album branch deliberately reads item.server_id, so a
    // replaced server object would only churn this callback's identity.
  }, [onNavigate, onSelectAlbum, onSelectArtist, onPlayTrack, onClose]);

  useEffect(() => {
    if (open) {
      setRaw("");
      // Reset the debounced value too, or the palette re-opens showing the
      // previous session's results for the 150ms until the timer catches up.
      setDeferred("");
      setFocusedKey(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => { setFocusedKey(null); }, [deferred]);

  // .cp-results is a 420px scroller and there can be 15 result rows, so arrowing
  // down past the fold otherwise moves a selection the user can't see.
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusedIdx]);

  // Read through a ref, so the listener is armed once per open rather than torn down and
  // re-added for every keystroke, every arrow press and every result set that arrives - all of
  // which rebuild `items`. Same pattern as useSearchShortcuts.
  const keysRef = useRef({ items, focusedIdx, activate, onClose });
  keysRef.current = { items, focusedIdx, activate, onClose };

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      const { items, focusedIdx, activate, onClose } = keysRef.current;
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        // Derived from the previous key rather than the render-time index: this is a native
        // listener, so two presses arriving in one task are batched and both would read the
        // same snapshot and move a single row between them.
        setFocusedKey((current) => {
          const from = Math.max(0, items.findIndex((item) => itemKey(item) === current));
          const to = items[Math.min(Math.max(from + delta, 0), items.length - 1)];
          return to ? itemKey(to) : current;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[focusedIdx];
        if (item) activate(item);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  // placeholderData keeps the previous query's rows around on failure, so the
  // error branch has to win outright rather than render alongside stale results.
  const showResults = !isError && results;
  const isEmpty = deferred && showResults && searchAlbums.length === 0 && searchTracks.length === 0 && searchArtists.length === 0;

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
                    ref={i === focusedIdx ? focusedRef : null}
                    className={`cp-nav-item${i === focusedIdx ? " cp-item--focused" : ""}`}
                    onMouseEnter={() => setFocusedKey(itemKey(cmd))}
                    onMouseDown={(e) => { e.preventDefault(); activate(cmd); }}
                  >
                    <span className="cp-nav-icon">{cmd.icon}</span>
                    <span className="cp-nav-label">{cmd.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {deferred && isError && (
            <p className="cp-empty">Search failed. The library database could not be read.</p>
          )}

          {deferred && !isError && !results && (
            <p className="cp-empty">Searching…</p>
          )}

          {deferred && showResults && isEmpty && (
            <p className="cp-empty">No results for "{deferred}"</p>
          )}

          {deferred && showResults && searchArtists.length > 0 && (
            <div className="cp-section">
              <p className="cp-section-label">Artists</p>
              {searchArtists.map((artist, i) => {
                const idx = artistOffset + i;
                return (
                  <button
                    key={artist.name}
                    ref={idx === focusedIdx ? focusedRef : null}
                    className={`cp-result-row${idx === focusedIdx ? " cp-item--focused" : ""}`}
                    onMouseEnter={() => setFocusedKey(itemKey(artist))}
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

          {deferred && showResults && searchAlbums.length > 0 && (
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
                    ref={idx === focusedIdx ? focusedRef : null}
                    className={`cp-result-row${idx === focusedIdx ? " cp-item--focused" : ""}`}
                    onMouseEnter={() => setFocusedKey(itemKey(album))}
                    onMouseDown={(e) => { e.preventDefault(); activate(album); }}
                  >
                    {artUrl
                      ? <img className="cp-art" src={artUrl} alt="" />
                      : <div className="cp-art cp-art--placeholder" />}
                    <span className="cp-result-primary">{albumDisplayName(album.name)}</span>
                    {album.artist && <span className="cp-result-secondary">{album.artist}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {deferred && showResults && searchTracks.length > 0 && (
            <div className="cp-section">
              <p className="cp-section-label">Tracks</p>
              {searchTracks.map((track, i) => {
                const idx = trackOffset + i;
                return (
                  <button
                    key={track.id}
                    ref={idx === focusedIdx ? focusedRef : null}
                    className={`cp-result-row${idx === focusedIdx ? " cp-item--focused" : ""}`}
                    onMouseEnter={() => setFocusedKey(itemKey(track))}
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
