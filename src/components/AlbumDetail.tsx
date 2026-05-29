import { useState } from "react";
import { Heart, Play, ChevronRight } from "lucide-react";
import { ContextMenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import { TagDrawer } from "./TagDrawer";
import type { AlbumRow } from "../hooks/useAlbums";
import type { ServerWithCredential } from "../hooks/useServer";
import type { TrackRow } from "../hooks/useTracks";
import { useTracks } from "../hooks/useTracks";
import { useLoved } from "../hooks/useLoved";
import { usePlaylists } from "../hooks/usePlaylists";
import { useNormalizeAlbum } from "../hooks/useNormalizeAlbum";
import { getCoverArtUrl, getStreamUrl } from "../lib/navidrome";
import { stripServerPrefix } from "../lib/ids";
import type { CurrentTrack } from "../store/player";
import { usePlayerStore } from "../store/player";
import { useGenreMappings, applyGenreMappings } from "../hooks/useGenreDisplay";
import "./AlbumDetail.css";

const SECONDS_PER_MINUTE = 60;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = seconds % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  album: AlbumRow;
  serverWithCredential: ServerWithCredential;
  onClose: () => void;
  onSelectArtist?: (artistName: string) => void;
  onTagFilter?: (filter: { canonicalId: string } | { rawGenre: string }) => void;
}

interface DrawerState {
  albumId: string;
  trackId?: string;
}

export function AlbumDetail({ album, serverWithCredential, onClose, onSelectArtist, onTagFilter }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: tracks, isLoading } = useTracks(album.id);
  const { lovedTrackIds, toggleTrackLove } = useLoved();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const { data: playlists, addTrackToPlaylist } = usePlaylists();
  const { data: normalizedTags } = useNormalizeAlbum(album.id, album.artist ?? "", album.name);
  const genreMappings = useGenreMappings();

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: TrackRow } | null>(null);
  const [contextMenuMode, setContextMenuMode] = useState<"main" | "playlist">("main");
  const [drawerState, setDrawerState] = useState<DrawerState | null>(null);

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

  function handlePlayAlbum() {
    if (!tracks || tracks.length === 0) return;
    playQueue(tracks.map(buildTrackObj), streamUrlFor, 0);
  }

  const hasTags = normalizedTags && (
    normalizedTags.genres.length > 0 ||
    normalizedTags.descriptors.length > 0 ||
    normalizedTags.scenes.length > 0
  );

  return (
    <div className="album-detail">
      <div className="album-detail-header">
        {coverArtUrl && (
          <div
            className="album-detail-hero-bg"
            style={{ backgroundImage: `url(${coverArtUrl})` }}
          />
        )}
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
            {album.artist && (
              onSelectArtist ? (
                <button
                  className="album-detail-artist album-detail-artist--link"
                  onClick={() => onSelectArtist(album.artist!)}
                >
                  {album.artist}
                </button>
              ) : (
                <p className="album-detail-artist">{album.artist}</p>
              )
            )}
            {album.year && <p className="album-detail-year">{album.year}</p>}
            <button
              className="play-album-btn"
              onClick={handlePlayAlbum}
              disabled={!tracks || tracks.length === 0}
              aria-label="Play album"
            >
              <Play size={16} /> Play Album
            </button>
          </div>
        </div>
      </div>

      {hasTags && (
        <section className="album-tag-band">
          {normalizedTags.genres.length > 0 && (
            <div className="album-tag-column">
              <h3 className="album-tag-column-title">Genres</h3>
              {normalizedTags.genres.map((tag) => (
                <button
                  key={tag.id ?? tag.name}
                  className="album-tag-chip"
                  onClick={() => onTagFilter?.(tag.id !== null ? { canonicalId: tag.id } : { rawGenre: tag.name })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setDrawerState({ albumId: album.id });
                  }}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
          {normalizedTags.descriptors.length > 0 && (
            <div className="album-tag-column">
              <h3 className="album-tag-column-title">Descriptors</h3>
              {normalizedTags.descriptors.map((tag) => (
                <button
                  key={tag.id ?? tag.name}
                  className="album-tag-chip"
                  onClick={() => tag.id !== null && onTagFilter?.({ canonicalId: tag.id })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setDrawerState({ albumId: album.id });
                  }}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
          {normalizedTags.scenes.length > 0 && (
            <div className="album-tag-column">
              <h3 className="album-tag-column-title">Scenes & Movements</h3>
              {normalizedTags.scenes.map((tag) => (
                <button
                  key={tag.id ?? tag.name}
                  className="album-tag-chip"
                  onClick={() => tag.id !== null && onTagFilter?.({ canonicalId: tag.id })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setDrawerState({ albumId: album.id });
                  }}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

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
                return (
                  <tr
                    key={track.id}
                    className={`tracklist-row tracklist-row--playable${isCurrentTrack ? " tracklist-row--active" : ""}`}
                    onClick={() => handlePlayTrack(track)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, track });
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && handlePlayTrack(track)}
                  >
                    <td className="track-number">
                      {isCurrentlyPlaying ? (
                        <span className="track-playing-indicator">
                          <Play size={12} />
                        </span>
                      ) : (
                        track.track_number ?? "—"
                      )}
                    </td>
                    <td className="track-title">{track.title}</td>
                    <td className="track-artist">{track.artist ?? ""}</td>
                    <td className="track-genre">
                      {applyGenreMappings(track.genre, genreMappings).map((g, i) => (
                        <span key={i} className="track-genre-chip">{g}</span>
                      ))}
                    </td>
                    <td className="track-duration">
                      {track.duration ? formatDuration(track.duration) : ""}
                    </td>
                    <td className="track-heart-cell">
                      <button
                        className={`track-heart${lovedTrackIds.has(track.id) ? " track-heart--loved" : ""}`}
                        aria-label={lovedTrackIds.has(track.id) ? "Unlove track" : "Love track"}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleTrackLove(track.id, serverWithCredential);
                        }}
                      >
                        <Heart
                          size={15}
                          fill={lovedTrackIds.has(track.id) ? "currentColor" : "none"}
                          strokeWidth={2}
                        />
                      </button>
                    </td>
                  </tr>
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
          onClose={() => {
            setContextMenu(null);
            setContextMenuMode("main");
          }}
        >
          {contextMenuMode === "main" ? (
            <>
              <button
                onClick={() => {
                  handlePlayTrack(contextMenu.track);
                  setContextMenu(null);
                }}
              >
                Play Now
              </button>
              <button
                onClick={() => {
                  playNext(buildTrackObj(contextMenu.track), streamUrlFor);
                  setContextMenu(null);
                }}
              >
                Play Next
              </button>
              <button
                onClick={() => {
                  addToQueue(buildTrackObj(contextMenu.track), streamUrlFor);
                  setContextMenu(null);
                }}
              >
                Add to Queue
              </button>
              <StartRadioSubmenu
                onSelect={(mode) => {
                  const track = buildTrackObj(contextMenu.track);
                  void playQueue([track], streamUrlFor, 0);
                  startRadio(track, mode);
                  setContextMenu(null);
                }}
              />
              <button
                onClick={() => {
                  setDrawerState({ albumId: album.id, trackId: contextMenu.track.id });
                  setContextMenu(null);
                }}
              >
                Show tags
              </button>
              {playlists && playlists.length > 0 && (
                <button onClick={() => setContextMenuMode("playlist")}>
                  Add to Playlist <ChevronRight size={16} />
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

      {drawerState && (
        <TagDrawer
          albumId={drawerState.albumId}
          albumArtist={album.artist ?? ""}
          albumName={album.name}
          trackId={drawerState.trackId}
          hasSidecar={!!server.sidecar_url}
          onClose={() => setDrawerState(null)}
        />
      )}
    </div>
  );
}
