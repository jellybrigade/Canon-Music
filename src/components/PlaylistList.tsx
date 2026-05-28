import { useState, useRef, useEffect } from "react";
import { Plus } from "lucide-react";
import type { PlaylistRow } from "../hooks/usePlaylists";
import type { ServerWithCredential } from "../hooks/useServer";
import "./PlaylistList.css";

interface Props {
  playlists: PlaylistRow[];
  serverWithCredential: ServerWithCredential;
  onSelect: (playlist: PlaylistRow) => void;
  onCreatePlaylist: (name: string, swc: ServerWithCredential) => Promise<void>;
}

export function PlaylistList({ playlists, serverWithCredential, onSelect, onCreatePlaylist }: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  async function handleCreate(e: React.FormEvent) {
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
          <Plus size={14} />
          New Playlist
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
      {playlists.map((pl) => (
        <button
          key={pl.id}
          className="playlist-row"
          onClick={() => onSelect(pl)}
        >
          <span className="playlist-row-name">{pl.name}</span>
          <span className="playlist-row-meta">
            {pl.track_count} {pl.track_count === 1 ? "track" : "tracks"}
          </span>
        </button>
      ))}
    </div>
  );
}
