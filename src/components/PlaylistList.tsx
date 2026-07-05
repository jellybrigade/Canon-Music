import { useState, useRef, useEffect } from "react";
import { Plus, Music, ListMusic } from "lucide-react";
import type { PlaylistRow } from "../hooks/usePlaylists";
import type { ServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl } from "../lib/navidrome";
import { SmartPlaylistModal } from "./SmartPlaylistModal";
import { ContextMenu } from "./ContextMenu";
import type { SmartFilters } from "../lib/smartPlaylist";
import "./PlaylistList.css";

interface Props {
  playlists: PlaylistRow[];
  serverWithCredential: ServerWithCredential;
  onSelect: (playlist: PlaylistRow) => void;
  onCreatePlaylist: (name: string, swc: ServerWithCredential) => Promise<void>;
  onCreateSmartPlaylist: (filters: SmartFilters, swc: ServerWithCredential) => Promise<void>;
  onDelete?: (playlist: PlaylistRow) => Promise<void>;
  onRename?: (playlist: PlaylistRow, name: string, comment: string | null, swc: ServerWithCredential) => Promise<void>;
  onUpdateSmartRules?: (playlist: PlaylistRow, filters: SmartFilters, swc: ServerWithCredential) => Promise<void>;
  onSetCustomCover?: (playlistId: string, dataUri: string | null) => Promise<void>;
}

export function PlaylistList({ playlists, serverWithCredential, onSelect, onCreatePlaylist, onCreateSmartPlaylist, onDelete, onRename, onUpdateSmartRules, onSetCustomCover }: Props) {
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
  const renameInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverTargetId = useRef<string | null>(null);

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
    if (!file || !onSetCustomCover || !targetId) return;
    const reader = new FileReader();
    reader.onload = () => {
      void onSetCustomCover(targetId, reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
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
    <div className="playlist-list">
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
      {playlists.length === 0 && !creating && (
        <p className="empty-state">No playlists. Create one or Rescan.</p>
      )}
      <div className="playlist-card-grid">
        {playlists.map((pl) => {
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
      {editSmartPlaylist && onUpdateSmartRules && editSmartPlaylist.rules_json && (
        <SmartPlaylistModal
          title="Edit Smart Playlist"
          initialFilters={JSON.parse(editSmartPlaylist.rules_json) as SmartFilters}
          onSave={(filters) => onUpdateSmartRules(editSmartPlaylist, filters, serverWithCredential)}
          onClose={() => setEditSmartPlaylist(null)}
        />
      )}
    </div>
  );
}
