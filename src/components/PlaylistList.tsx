import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus, Music, ListMusic } from "lucide-react";
import type { PlaylistRow } from "../hooks/usePlaylists";
import type { ServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl } from "../lib/navidrome";
import { SmartPlaylistModal } from "./SmartPlaylistModal";
import { ContextMenu } from "./ContextMenu";
import { parseSmartFilters, type SmartFilters } from "../lib/smartPlaylist";
import { fileToScaledDataUri } from "../lib/imageDataUri";
import "./PlaylistList.css";

// Grid geometry (mirrors .playlist-card-grid in PlaylistList.css)
const CARD_MIN = 160;    // minmax(160px, 1fr)
const GRID_GAP = 16;     // --space-md (row + column gap)
const GRID_PAD_X = 16;   // --space-md (horizontal padding)
const ART_MARGIN = 8;    // --space-xs (art margin-bottom)
// Info block: name (text-md 18px * 1.5) + gap (--space-2xs 4px) + meta (text-base 16px * 1.5)
const INFO_HEIGHT = 27 + 4 + 24;

interface Props {
  // Undefined while the first read is in flight, distinct from a server that genuinely
  // has no playlists. Collapsing the two showed the "no playlists" empty state, which
  // tells the user to create one, before the load had a chance to return any.
  playlists: PlaylistRow[] | undefined;
  serverWithCredential: ServerWithCredential;
  onSelect: (playlist: PlaylistRow) => void;
  onCreatePlaylist: (name: string, swc: ServerWithCredential) => Promise<void>;
  onCreateSmartPlaylist: (filters: SmartFilters, swc: ServerWithCredential) => Promise<void>;
  onDelete?: (playlist: PlaylistRow) => Promise<void>;
  onRename?: (playlist: PlaylistRow, name: string, comment: string | null, swc: ServerWithCredential) => Promise<void>;
  onUpdateSmartRules?: (playlist: PlaylistRow, filters: SmartFilters, swc: ServerWithCredential) => Promise<void>;
  onSetCustomCover?: (playlistId: string, dataUri: string | null) => Promise<void>;
}

export function PlaylistList({ playlists: playlistsProp, serverWithCredential, onSelect, onCreatePlaylist, onCreateSmartPlaylist, onDelete, onRename, onUpdateSmartRules, onSetCustomCover }: Props) {
  const isLoading = playlistsProp === undefined;
  const playlists = useMemo(() => playlistsProp ?? [], [playlistsProp]);
  const { server, credential } = serverWithCredential;
  const [creating, setCreating] = useState(false);
  const [showSmartModal, setShowSmartModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; playlist: PlaylistRow } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [editSmartPlaylist, setEditSmartPlaylist] = useState<PlaylistRow | null>(null);
  // Parsed outside the render body's JSX: an unparseable `rules_json` used to throw from
  // inside the element tree, which the ErrorBoundary turns into a blank playlists page.
  const editSmartRules = useMemo(
    () => parseSmartFilters(editSmartPlaylist?.rules_json ?? null),
    [editSmartPlaylist]
  );
  const renameInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverTargetId = useRef<string | null>(null);

  // ── Virtualization (mirrors AlbumGrid's useVirtualizer pattern) ──
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      setContainerWidth(el.clientWidth);
      if (gridRef.current) setScrollMargin(gridRef.current.offsetTop);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // The card grid sits below the toolbar/create-form inside the same scroller;
  // re-measure its offset (the virtualizer's scrollMargin) when that height changes.
  useLayoutEffect(() => {
    if (gridRef.current) setScrollMargin(gridRef.current.offsetTop);
  }, [creating, playlists.length, containerWidth]);

  const available = containerWidth > 0 ? containerWidth - GRID_PAD_X * 2 : 0;
  const cols = Math.max(1, Math.floor((available + GRID_GAP) / (CARD_MIN + GRID_GAP)));
  const cardWidth = available > 0 ? (available - GRID_GAP * (cols - 1)) / cols : CARD_MIN;
  const cardHeight = Math.round(cardWidth) + ART_MARGIN + INFO_HEIGHT;
  const rowHeight = cardHeight + GRID_GAP;

  const rows = useMemo<PlaylistRow[][]>(() => {
    const result: PlaylistRow[][] = [];
    for (let i = 0; i < playlists.length; i += cols)
      result.push(playlists.slice(i, i + cols));
    return result;
  }, [playlists, cols]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollMargin,
  });

  const prevLayoutKey = useRef(`${cols}-${rowHeight}-${rows.length}-${scrollMargin}`);
  useLayoutEffect(() => {
    const key = `${cols}-${rowHeight}-${rows.length}-${scrollMargin}`;
    if (prevLayoutKey.current !== key) {
      prevLayoutKey.current = key;
      virtualizer.measure();
    }
  }, [cols, rowHeight, rows.length, scrollMargin, virtualizer]);

  useEffect(() => { if (renamingId) renameInputRef.current?.focus(); }, [renamingId]);

  function handleContextMenu(e: React.MouseEvent, playlist: PlaylistRow) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, playlist });
  }

  function startRename(playlist: PlaylistRow) {
    setRenamingId(playlist.id);
    setRenameValue(playlist.name);
    setContextMenu(null);
  }

  async function commitRename(playlist: PlaylistRow) {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!onRename || !trimmed || trimmed === playlist.name) return;
    try {
      await onRename(playlist, trimmed, playlist.comment, serverWithCredential);
    } catch (err) {
      console.error("Failed to rename playlist:", err);
    }
  }

  async function handleDelete(playlist: PlaylistRow) {
    if (!onDelete) return;
    setContextMenu(null);
    try {
      await onDelete(playlist);
    } catch (err) {
      console.error("Failed to delete playlist:", err);
    } finally {
      setConfirmDeleteId(null);
    }
  }

  function pickCover(playlist: PlaylistRow) {
    coverTargetId.current = playlist.id;
    setContextMenu(null);
    coverInputRef.current?.click();
  }

  function handleCoverPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const targetId = coverTargetId.current;
    e.target.value = "";
    if (!file || !onSetCustomCover || !targetId) return;
    fileToScaledDataUri(file)
      .then((dataUri) => onSetCustomCover(targetId, dataUri))
      .catch((err) => console.error("Failed to set playlist cover:", err));
  }

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  async function handleCreate(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await onCreatePlaylist(name, serverWithCredential);
      setNewName("");
      setCreating(false);
    } catch (err) {
      console.error("Failed to create playlist:", err);
    } finally {
      setSaving(false);
    }
  }

  function handleCancelCreate() {
    setCreating(false);
    setNewName("");
  }

  return (
    <div className="playlist-list" ref={containerRef}>
      <div className="playlist-list-toolbar">
        <button
          className="playlist-create-btn"
          onClick={() => setCreating((v) => !v)}
          title="New playlist"
        >
          <Plus size={16} />
          New Playlist
        </button>
        <button
          className="playlist-create-btn"
          onClick={() => setShowSmartModal(true)}
          title="New smart playlist"
        >
          <ListMusic size={16} />
          Smart Playlist
        </button>
      </div>
      {creating && (
        <form className="playlist-create-form" onSubmit={handleCreate}>
          <input
            ref={inputRef}
            type="text"
            className="playlist-create-input"
            placeholder="Playlist name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") handleCancelCreate(); }}
          />
          <button type="submit" disabled={!newName.trim() || saving}>
            {saving ? "Creating…" : "Create"}
          </button>
          <button type="button" onClick={handleCancelCreate}>
            Cancel
          </button>
        </form>
      )}
      {isLoading && <p className="empty-state">Loading playlists…</p>}
      {!isLoading && playlists.length === 0 && !creating && (
        <p className="empty-state">No playlists. Create one or Rescan.</p>
      )}
      {playlists.length > 0 && (
        <div ref={gridRef} style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowItems = rows[virtualRow.index];
            if (!rowItems) return null;
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: `${GRID_PAD_X}px`,
                  right: `${GRID_PAD_X}px`,
                  transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                  height: `${cardHeight}px`,
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  columnGap: `${GRID_GAP}px`,
                }}
              >
                {rowItems.map((pl) => {
                  const artUrl = pl.custom_cover_data
                    ?? (pl.cover_art_url
                      ? getCoverArtUrl(server.url, server.username, credential, pl.cover_art_url, 300)
                      : null);
                  return (
                    <button
                      key={pl.id}
                      className="playlist-card"
                      onClick={() => onSelect(pl)}
                      onContextMenu={(e) => handleContextMenu(e, pl)}
                    >
                      <div className="playlist-card-art">
                        {artUrl ? (
                          <img src={artUrl} alt={pl.name} draggable={false} />
                        ) : (
                          <div className="playlist-card-art-placeholder">
                            {pl.is_smart ? <ListMusic size={32} /> : <Music size={32} />}
                          </div>
                        )}
                      </div>
                      <div className="playlist-card-info">
                        {renamingId === pl.id ? (
                          <input
                            ref={renameInputRef}
                            className="playlist-create-input"
                            value={renameValue}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => void commitRename(pl)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); void commitRename(pl); }
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                          />
                        ) : (
                          <span className="playlist-card-name">{pl.name}</span>
                        )}
                        <span className="playlist-card-meta">
                          {pl.is_smart ? "Smart · " : ""}{pl.track_count} {pl.track_count === 1 ? "track" : "tracks"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {showSmartModal && (
        <SmartPlaylistModal
          onSave={(filters) => onCreateSmartPlaylist(filters, serverWithCredential)}
          onClose={() => setShowSmartModal(false)}
        />
      )}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => { setContextMenu(null); setConfirmDeleteId(null); }}>
          <button onClick={() => { onSelect(contextMenu.playlist); setContextMenu(null); }}>
            Open
          </button>
          {onRename && (
            <button onClick={() => startRename(contextMenu.playlist)}>
              Rename
            </button>
          )}
          {onUpdateSmartRules && !!contextMenu.playlist.is_smart && (
            <button onClick={() => { setEditSmartPlaylist(contextMenu.playlist); setContextMenu(null); }}>
              Edit Smart Rules
            </button>
          )}
          {onSetCustomCover && (
            <button onClick={() => pickCover(contextMenu.playlist)}>
              Set Cover
            </button>
          )}
          {onDelete && (
            confirmDeleteId === contextMenu.playlist.id ? (
              <button className="context-menu-danger" onClick={() => void handleDelete(contextMenu.playlist)}>
                Delete for real?
              </button>
            ) : (
              <button className="context-menu-danger" onClick={() => setConfirmDeleteId(contextMenu.playlist.id)}>
                Delete
              </button>
            )
          )}
        </ContextMenu>
      )}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleCoverPick}
      />
      {editSmartPlaylist && onUpdateSmartRules && editSmartRules && (
        <SmartPlaylistModal
          title="Edit Smart Playlist"
          initialFilters={editSmartRules}
          onSave={(filters) => onUpdateSmartRules(editSmartPlaylist, filters, serverWithCredential)}
          onClose={() => setEditSmartPlaylist(null)}
        />
      )}
    </div>
  );
}
