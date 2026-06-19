import { useState, useRef, useEffect } from "react";
import { Plus, Music } from "lucide-react";
import type { PlaylistRow } from "../hooks/usePlaylists";
import type { ServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl } from "../lib/navidrome";
import "./PlaylistList.css";

interface Props {
  playlists: PlaylistRow[];
  serverWithCredential: ServerWithCredential;
  onSelect: (playlist: PlaylistRow) => void;
  onCreatePlaylist: (name: string, swc: ServerWithCredential) => Promise<void>;
}

export function PlaylistList({ playlists, serverWithCredential, onSelect, onCreatePlaylist }: Props) {
  const { server, credential } = serverWithCredential;
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
          const artUrl = pl.cover_art_url
            ? getCoverArtUrl(server.url, server.username, credential, pl.cover_art_url, 300)
            : null;
          return (
            <button
              key={pl.id}
              className="playlist-card"
              onClick={() => onSelect(pl)}
            >
              <div className="playlist-card-art">
                {artUrl ? (
                  <img src={artUrl} alt={pl.name} draggable={false} />
                ) : (
                  <div className="playlist-card-art-placeholder">
                    <Music size={32} />
                  </div>
                )}
              </div>
              <div className="playlist-card-info">
                <span className="playlist-card-name">{pl.name}</span>
                <span className="playlist-card-meta">
                  {pl.track_count} {pl.track_count === 1 ? "track" : "tracks"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
