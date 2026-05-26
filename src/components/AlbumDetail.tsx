import { useState, Fragment } from "react";
import { Heart, RefreshCw, Wand2, Play, ChevronRight } from "lucide-react";
import { ContextMenu } from "./ContextMenu";
import type { AlbumRow } from "../hooks/useAlbums";
import type { ServerWithCredential } from "../hooks/useServer";
import type { TrackRow } from "../hooks/useTracks";
import { useTracks } from "../hooks/useTracks";
import { useLoved } from "../hooks/useLoved";
import { usePlaylists } from "../hooks/usePlaylists";
import { usePendingEdits } from "../hooks/usePendingEdits";
import { useTagPull } from "../hooks/useTagPull";
import { useSetting } from "../hooks/useSetting";
import { getCoverArtUrl, getStreamUrl } from "../lib/navidrome";
import { stripServerPrefix } from "../lib/ids";
import type { CurrentTrack } from "../store/player";
import { usePlayerStore } from "../store/player";
import type { PullMode } from "../hooks/useTagPull";

const SECONDS_PER_MINUTE = 60;

const EDITOR_FIELDS: { key: keyof EditFields; label: string; type: "text" | "number" }[] = [
  { key: "title", label: "Title", type: "text" },
  { key: "artist", label: "Artist", type: "text" },
  { key: "album_artist", label: "Album Artist", type: "text" },
  { key: "genre", label: "Genre", type: "text" },
  { key: "track_number", label: "Track #", type: "number" },
  { key: "disc_number", label: "Disc #", type: "number" },
  { key: "year", label: "Year", type: "number" },
  { key: "comment", label: "Comment", type: "text" },
];

interface EditFields {
  title: string;
  artist: string;
  album_artist: string;
  genre: string;
  track_number: string;
  disc_number: string;
  year: string;
  comment: string;
}

function trackToEditFields(track: TrackRow): EditFields {
  return {
    title: track.title ?? "",
    artist: track.artist ?? "",
    album_artist: track.album_artist ?? "",
    genre: track.genre ?? "",
    track_number: track.track_number != null ? String(track.track_number) : "",
    disc_number: track.disc_number != null ? String(track.disc_number) : "",
    year: track.year != null ? String(track.year) : "",
    comment: "",
  };
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = seconds % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  album: AlbumRow;
  serverWithCredential: ServerWithCredential;
  onClose: () => void;
}

export function AlbumDetail({ album, serverWithCredential, onClose }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: tracks, isLoading } = useTracks(album.id);
  const { lovedTrackIds, toggleTrackLove } = useLoved();
  const play = usePlayerStore((s) => s.play);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const { data: playlists, addTrackToPlaylist } = usePlaylists();
  const { addPendingEdits } = usePendingEdits();
  const { pullForAlbum, canonizeAlbum } = useTagPull();
  const [pullModeDefault] = useSetting("tags.pull_mode_default", "review");
  const [albumActionMsg, setAlbumActionMsg] = useState("");

  function showActionMsg(msg: string) {
    setAlbumActionMsg(msg);
    setTimeout(() => setAlbumActionMsg(""), 2500);
  }

  async function handlePullLastfm() {
    try {
      await pullForAlbum.mutateAsync({ album, mode: "review" as PullMode });
      showActionMsg("Tags queued in Inbox");
    } catch (e) {
      showActionMsg(e instanceof Error ? e.message : "Pull failed");
    }
  }

  async function handleCanonize() {
    try {
      await canonizeAlbum.mutateAsync({ album, mode: pullModeDefault as PullMode });
      showActionMsg(pullModeDefault === "silent" ? "Canonized" : "Proposals queued in Inbox");
    } catch (e) {
      showActionMsg(e instanceof Error ? e.message : "Canonize failed");
    }
  }

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: TrackRow } | null>(null);
  const [contextMenuMode, setContextMenuMode] = useState<"main" | "playlist">("main");
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFields>({ title: "", artist: "", album_artist: "", genre: "", track_number: "", disc_number: "", year: "", comment: "" });
  const [editSaveMsg, setEditSaveMsg] = useState<string>("");

  const coverArtUrl = album.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 500)
    : null;

  function buildTrackObj(track: TrackRow): CurrentTrack {
    return {
      id: track.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      coverArtUrl,
      artworkRef: album.artwork_url ?? null,
      album: album.name,
      albumId: album.id,
    };
  }

  function streamUrlFor(track: CurrentTrack): string {
    const navTrackId = stripServerPrefix(track.id, server.id);
    return getStreamUrl(server.url, server.username, credential, navTrackId);
  }

  function handlePlayTrack(track: TrackRow) {
    if (!tracks) return;
    const startIndex = tracks.findIndex((t) => t.id === track.id);
    playQueue(tracks.map(buildTrackObj), streamUrlFor, startIndex >= 0 ? startIndex : 0);
  }

  function handleOpenEditor(track: TrackRow) {
    setEditingTrackId(track.id);
    setEditFields(trackToEditFields(track));
    setEditSaveMsg("");
    setContextMenu(null);
  }

  async function handleSaveEdit(track: TrackRow) {
    const original = trackToEditFields(track);
    const fieldChanges: { field: string; oldValue: string | null; newValue: string }[] = [];
    for (const { key } of EDITOR_FIELDS) {
      const newValue = editFields[key].trim();
      const oldValue = original[key].trim() || null;
      if (newValue !== (original[key].trim())) {
        fieldChanges.push({ field: key, oldValue: oldValue || null, newValue });
      }
    }
    if (fieldChanges.length === 0) {
      setEditingTrackId(null);
      return;
    }
    await addPendingEdits.mutateAsync({ trackId: track.id, fieldChanges });
    setEditingTrackId(null);
    setEditSaveMsg(track.id);
    setTimeout(() => setEditSaveMsg(""), 3000);
  }

  function handlePlayAlbum() {
    if (!tracks || tracks.length === 0) return;
    playQueue(tracks.map(buildTrackObj), streamUrlFor, 0);
  }

  return (
    <div className="album-detail">
      <div className="album-detail-header">
        <button className="album-detail-back" onClick={onClose}>
          ← Back
        </button>
        <div className="album-detail-hero">
          {coverArtUrl ? (
            <img className="album-detail-art" src={coverArtUrl} alt={album.name} />
          ) : (
            <div className="album-detail-art album-art--placeholder" />
          )}
          <div className="album-detail-meta">
            <h2 className="album-detail-title">{album.name}</h2>
            {album.artist && <p className="album-detail-artist">{album.artist}</p>}
            {album.year && <p className="album-detail-year">{album.year}</p>}
            <button
              className="play-album-btn"
              onClick={handlePlayAlbum}
              disabled={!tracks || tracks.length === 0}
              aria-label="Play album"
            >
              <Play size={14} /> Play Album
            </button>
            <div className="album-tag-actions">
              <button
                className="album-tag-action-btn"
                onClick={() => void handlePullLastfm()}
                disabled={pullForAlbum.isPending}
                title="Refresh tags from Last.fm"
              >
                <RefreshCw size={13} className={pullForAlbum.isPending ? "health-spin" : ""} />
                Last.fm
              </button>
              <button
                className="album-tag-action-btn"
                onClick={() => void handleCanonize()}
                disabled={canonizeAlbum.isPending}
                title="Canonize tags against RYM hierarchy"
              >
                <Wand2 size={13} />
                Canonize
              </button>
              {albumActionMsg && (
                <span className="album-tag-action-msg">{albumActionMsg}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="album-detail-body">
        {isLoading ? (
          <p className="empty-state">Loading tracks…</p>
        ) : !tracks || tracks.length === 0 ? (
          <p className="empty-state">No tracks synced yet.</p>
        ) : (
          <table className="tracklist">
            <tbody>
              {tracks.map((track) => {
                const isCurrentlyPlaying = currentTrack?.id === track.id && isPlaying;
                const isCurrentTrack = currentTrack?.id === track.id;
                const isEditing = editingTrackId === track.id;
                return (
                  <Fragment key={track.id}>
                    <tr
                      className={`tracklist-row tracklist-row--playable${isCurrentTrack ? " tracklist-row--active" : ""}`}
                      onClick={() => { if (!isEditing) handlePlayTrack(track); }}
                      onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, track }); }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && !isEditing && handlePlayTrack(track)}
                    >
                      <td className="track-number">
                        {isCurrentlyPlaying
                          ? <span className="track-playing-indicator"><Play size={10} /></span>
                          : (track.track_number ?? "—")}
                      </td>
                      <td className="track-title">
                        {track.title}
                        {editSaveMsg === track.id && (
                          <span className="tag-editor-save-msg"> — edit queued</span>
                        )}
                      </td>
                      <td className="track-artist">{track.artist ?? ""}</td>
                      <td className="track-genre">{track.genre ?? ""}</td>
                      <td className="track-duration">
                        {track.duration ? formatDuration(track.duration) : ""}
                      </td>
                      <td className="track-heart-cell">
                        <button
                          className={`track-heart${lovedTrackIds.has(track.id) ? " track-heart--loved" : ""}`}
                          aria-label={lovedTrackIds.has(track.id) ? "Unlove track" : "Love track"}
                          onClick={(e) => { e.stopPropagation(); void toggleTrackLove(track.id, serverWithCredential); }}
                        >
                          <Heart
                            size={13}
                            fill={lovedTrackIds.has(track.id) ? "currentColor" : "none"}
                            strokeWidth={2}
                          />
                        </button>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr key={`${track.id}-edit`} className="tracklist-edit-row">
                        <td colSpan={6} onClick={(e) => e.stopPropagation()}>
                          <div className="tag-editor">
                            <div className="tag-editor-grid">
                              {EDITOR_FIELDS.map(({ key, label, type }) => (
                                <label key={key} className="tag-editor-field">
                                  <span>{label}</span>
                                  <input
                                    type={type}
                                    value={editFields[key]}
                                    onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") void handleSaveEdit(track);
                                      if (e.key === "Escape") setEditingTrackId(null);
                                    }}
                                  />
                                </label>
                              ))}
                            </div>
                            <div className="tag-editor-actions">
                              <button
                                className="tag-editor-save-btn"
                                onClick={() => void handleSaveEdit(track)}
                                disabled={addPendingEdits.isPending}
                              >
                                {addPendingEdits.isPending ? "Saving…" : "Save"}
                              </button>
                              <button
                                className="tag-editor-cancel-btn"
                                onClick={() => setEditingTrackId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => { setContextMenu(null); setContextMenuMode("main"); }}
        >
          {contextMenuMode === "main" ? (
            <>
              <button onClick={() => { handlePlayTrack(contextMenu.track); setContextMenu(null); }}>
                Play Now
              </button>
              <button onClick={() => { playNext(buildTrackObj(contextMenu.track), streamUrlFor); setContextMenu(null); }}>
                Play Next
              </button>
              <button onClick={() => { addToQueue(buildTrackObj(contextMenu.track), streamUrlFor); setContextMenu(null); }}>
                Add to Queue
              </button>
              <button onClick={() => {
                const track = buildTrackObj(contextMenu.track);
                void play(track, streamUrlFor(track));
                startRadio(track);
                setContextMenu(null);
              }}>
                Start radio from this
              </button>
              {playlists && playlists.length > 0 && (
                <button onClick={() => setContextMenuMode("playlist")}>
                  Add to Playlist <ChevronRight size={14} />
                </button>
              )}
              {server.sidecar_url ? (
                <button
                  onClick={() => handleOpenEditor(contextMenu.track)}
                  title={!contextMenu.track.file_path ? "Rescan required to enable tag editing" : undefined}
                  disabled={!contextMenu.track.file_path}
                >
                  Edit tags
                </button>
              ) : (
                <button disabled title="Configure sidecar in server settings to enable tag editing">
                  Edit tags
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={() => setContextMenuMode("main")}>← Back</button>
              {playlists?.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => {
                    void addTrackToPlaylist(pl, contextMenu.track.id, serverWithCredential);
                    setContextMenu(null);
                  }}
                >
                  {pl.name}
                </button>
              ))}
            </>
          )}
        </ContextMenu>
      )}
    </div>
  );
}
