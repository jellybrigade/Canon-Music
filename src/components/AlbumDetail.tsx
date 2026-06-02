import { useState, useEffect, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Heart, Play, ChevronRight, Disc, HelpCircle } from "lucide-react";
import { ContextMenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import { TagDrawer } from "./TagDrawer";
import { AlbumIdentifyDialog } from "./IdentifyDialog";
import type { AlbumRow } from "../hooks/useAlbums";
import type { ServerWithCredential } from "../hooks/useServer";
import type { TrackRow } from "../hooks/useTracks";
import { useTracks } from "../hooks/useTracks";
import { useLoved } from "../hooks/useLoved";
import { usePlaylists } from "../hooks/usePlaylists";
import { useNormalizeAlbum } from "../hooks/useNormalizeAlbum";
import { normalizeAlbum } from "../lib/tag-normalize";
import { useAlbumIdentity, useSaveAlbumIdentity, useRecordFailedLookup } from "../hooks/useAlbumIdentity";
import { useAutoIdentifyAlbum } from "../hooks/useAutoIdentifyAlbum";
import { useSetting } from "../hooks/useSetting";
import { useGenreMappings } from "../hooks/useGenreDisplay";
import { getCoverArtUrl, getStreamUrl } from "../lib/navidrome";
import { stripServerPrefix } from "../lib/ids";
import { rawGenreId } from "../lib/canonicalize";
import type { CurrentTrack } from "../store/player";
import { usePlayerStore } from "../store/player";
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
  onTagFilter?: (canonicalId: string) => void;
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

  const queryClient = useQueryClient();
  const { data: playlists, addTrackToPlaylist } = usePlaylists();
  const { data: normalizedTags } = useNormalizeAlbum(album.id, album.artist ?? "", album.name);
  const genreMappings = useGenreMappings();

  const { data: albumIdentity, isSuccess: identityLoaded } = useAlbumIdentity(album.id);
  const [mbAutoIdentify] = useSetting("mb.auto_identify", "false");

  const [isTagRefreshing, setIsTagRefreshing] = useState(false);
  const refreshTags = useCallback(async () => {
    if (isTagRefreshing) return;
    setIsTagRefreshing(true);
    try {
      await normalizeAlbum(album.id, album.artist ?? "", album.name, {
        lastfmArtistName: albumIdentity?.lastfm_artist_name ?? null,
        lastfmAlbumName: albumIdentity?.lastfm_album_name ?? null,
        combinedMbGenres: albumIdentity?.combined_genres_json
          ? (JSON.parse(albumIdentity.combined_genres_json) as Array<{ name: string; count: number }>)
          : null,
      });
      await queryClient.invalidateQueries({ queryKey: ["normalized-tags", album.id] });
    } catch {
      // silent
    } finally {
      setIsTagRefreshing(false);
    }
  }, [album.id, album.artist, album.name, albumIdentity, isTagRefreshing, queryClient]);
  const [playAction] = useSetting("album.play_action", "replace");

  const saveIdentity = useSaveAlbumIdentity();
  const recordFailed = useRecordFailedLookup();

  const { data: autoResult, isFetching: autoIdentifyFetching } = useAutoIdentifyAlbum({
    albumId: album.id,
    artist: album.artist ?? "",
    album: album.name,
    mbAutoIdentify,
    existingIdentity: albumIdentity,
    identityLoaded,
  });

  useEffect(() => {
    if (!autoResult) return;
    const { decision, score, detail, release, combinedGenres } = autoResult;

    if (decision === "auto_confirmed" && detail) {
      saveIdentity.mutate({
        albumId: album.id,
        mbReleaseGroupId: detail.id,
        mbReleaseId: release?.id ?? null,
        mbArtistId: detail.artistMbid,
        lastfmArtistName: null,
        lastfmAlbumName: null,
        lastfmMatchConfirmed: false,
        combinedGenres,
        label: release?.label ?? null,
        country: release?.country ?? null,
        catalogNumber: release?.catalogNumber ?? null,
        barcode: release?.barcode ?? null,
        releaseDate: release?.date ?? detail.firstReleaseDate ?? null,
        autoMatched: true,
        matchScore: Math.round(score * 100),
      });
    } else if (decision !== "error") {
      recordFailed.mutate({ albumId: album.id, matchScore: Math.round(score * 100) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResult?.decision, album.id]);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: TrackRow } | null>(null);
  const [contextMenuMode, setContextMenuMode] = useState<"main" | "playlist">("main");
  const [drawerState, setDrawerState] = useState<DrawerState | null>(null);
  const [showIdentify, setShowIdentify] = useState(false);

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
    const trackObjs = tracks.map(buildTrackObj);
    if (playAction === "queue_last") {
      for (const t of trackObjs) addToQueue(t, streamUrlFor);
    } else if (playAction === "queue_next") {
      for (let i = trackObjs.length - 1; i >= 0; i--) playNext(trackObjs[i]!, streamUrlFor);
    } else if (playAction === "shuffle") {
      const shuffled = [...trackObjs];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      void playQueue(shuffled, streamUrlFor, 0);
    } else {
      void playQueue(trackObjs, streamUrlFor, 0);
    }
  }

  const displayGenres = useMemo((): Array<{ id: string | null; name: string }> => {
    let raw: Array<{ id: string | null; name: string }>;
    if (normalizedTags?.genres.length) {
      raw = normalizedTags.genres;
    } else if (tracks) {
      const seen = new Set<string>();
      raw = [];
      for (const t of tracks) {
        if (t.genre && !seen.has(t.genre)) {
          seen.add(t.genre);
          raw.push({ id: null, name: t.genre });
        }
      }
    } else {
      return [];
    }
    // Drop unmapped tags (id=null) whose raw name maps to a canonical already shown,
    // preventing stale-cache duplicates like "Hip Hop" + "Rap".
    const shownNames = new Set(raw.filter((g) => g.id !== null).map((g) => g.name));
    return raw.filter((g) => {
      if (g.id !== null) return true;
      const mapped = genreMappings.get(g.name);
      if (mapped === null) return false;
      if (mapped !== undefined && shownNames.has(mapped)) return false;
      return true;
    });
  }, [normalizedTags, tracks, genreMappings]);

  const hasTags =
    displayGenres.length > 0 ||
    (normalizedTags?.descriptors?.length ?? 0) > 0 ||
    (normalizedTags?.scenes?.length ?? 0) > 0;

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
                <span
                  className="album-detail-artist album-detail-artist--link"
                  onClick={() => onSelectArtist(album.artist!)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && onSelectArtist(album.artist!)}
                >
                  {album.artist}
                </span>
              ) : (
                <p className="album-detail-artist">{album.artist}</p>
              )
            )}
            {album.year && !(albumIdentity?.confirmed_at && albumIdentity.release_date) && (
              <p className="album-detail-year">{album.year}</p>
            )}
            {albumIdentity?.confirmed_at ? (
              (albumIdentity.release_date || albumIdentity.label || albumIdentity.country) && (
                <div className="album-detail-identity">
                  <p className="mb-verified-facts">
                    {albumIdentity.release_date && (
                      <span>{albumIdentity.release_date.slice(0, 4)}</span>
                    )}
                    {albumIdentity.label && <span>{albumIdentity.label}</span>}
                    {albumIdentity.country && <span>{albumIdentity.country}</span>}
                    {albumIdentity.catalog_number && <span>{albumIdentity.catalog_number}</span>}
                  </p>
                </div>
              )
            ) : mbAutoIdentify === "true" && identityLoaded && !autoIdentifyFetching ? (
              <button
                className="album-unidentified-badge"
                onClick={() => setShowIdentify(true)}
                title="Album not identified on MusicBrainz — click to identify"
              >
                <HelpCircle size={12} /> Unidentified
              </button>
            ) : null}
            <div className="album-meta-refresh-line">
              {normalizedTags?.computed_at ? (
                <span className="album-meta-refresh-hint">
                  Tags updated {Math.floor((Date.now() / 1000 - normalizedTags.computed_at) / 86400) === 0
                    ? "today"
                    : `${Math.floor((Date.now() / 1000 - normalizedTags.computed_at) / 86400)}d ago`}
                </span>
              ) : null}
              <button
                className="album-meta-refresh-btn"
                onClick={() => { void refreshTags(); }}
                disabled={isTagRefreshing}
              >
                {isTagRefreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            <div className="album-detail-actions">
              <button
                className="play-album-btn"
                onClick={handlePlayAlbum}
                disabled={!tracks || tracks.length === 0}
                aria-label="Play album"
              >
                <Play size={16} /> Play Album
              </button>
              <button
                className="album-identify-btn"
                onClick={() => setShowIdentify(true)}
                aria-label="Identify album"
                title="Identify on MusicBrainz"
              >
                <Disc size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {hasTags && (
        <section className="album-tag-band">
          {displayGenres.length > 0 && (
            <div className="album-tag-column">
              <h3 className="album-tag-column-title">Genres</h3>
              {displayGenres.map((tag) => (
                <button
                  key={tag.id ?? tag.name}
                  className="album-tag-chip"
                  onClick={() => onTagFilter?.(tag.id !== null ? tag.id : rawGenreId(tag.name))}
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
          {normalizedTags && normalizedTags.descriptors.length > 0 && (
            <div className="album-tag-column">
              <h3 className="album-tag-column-title">Descriptors</h3>
              {normalizedTags.descriptors.map((tag) => (
                <button
                  key={tag.id ?? tag.name}
                  className="album-tag-chip"
                  onClick={() => onTagFilter?.(tag.id !== null ? tag.id : rawGenreId(tag.name))}
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
          {normalizedTags && normalizedTags.scenes.length > 0 && (
            <div className="album-tag-column">
              <h3 className="album-tag-column-title">Scenes & Movements</h3>
              {normalizedTags.scenes.map((tag) => (
                <button
                  key={tag.id ?? tag.name}
                  className="album-tag-chip"
                  onClick={() => onTagFilter?.(tag.id !== null ? tag.id : rawGenreId(tag.name))}
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
          onClose={() => setDrawerState(null)}
        />
      )}

      {showIdentify && (
        <AlbumIdentifyDialog
          albumId={album.id}
          artist={album.artist ?? ""}
          album={album.name}
          onClose={() => setShowIdentify(false)}
        />
      )}
    </div>
  );
}
