import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QK } from "../lib/queryKeys";
import { TagDrawer } from "../features/tags/components/TagDrawer";
import { AlbumGenreEditor } from "../components/AlbumGenreEditor";
import { AlbumIdentifyDialog } from "../features/enrichment/components/IdentifyDialog";
import { AlbumGrid } from "../components/AlbumGrid";
import { shuffleArray } from "../lib/shuffle";
import type { AlbumRow, TrackRow } from "../types/library";
import type { ServerWithCredential } from "../hooks/useServer";
import { useTracks } from "../hooks/useTracks";
import { useTrackListSessionStore } from "../store/trackListSessionStore";
import { useLoved } from "../hooks/useLoved";
import { usePlaylists } from "../features/playlists/usePlaylists";
import { useNormalizeAlbum } from "../features/tags/hooks/useNormalizeAlbum";
import { useEnrichAlbumTracks } from "../features/enrichment/hooks/useEnrichAlbumTracks";
import { useEnrichAlbum } from "../features/enrichment/hooks/useEnrichAlbum";
import { useEnrichArtist } from "../features/enrichment/hooks/useEnrichArtist";
import { useArtistAlbums } from "../hooks/useArtistAlbums";
import { useSimilarInLibrary } from "../features/enrichment/hooks/useSimilarInLibrary";
import { useSimilarArtistAlbums } from "../features/enrichment/hooks/useSimilarArtistAlbums";
import { normalizeAlbum } from "../features/tags/lib/tagNormalize";
import { useAlbumIdentity, useSaveAlbumIdentity, useRecordFailedLookup, useConfirmedArtistMbid } from "../features/enrichment/hooks/useAlbumIdentity";
import { useAutoIdentifyAlbum } from "../features/enrichment/hooks/useAutoIdentifyAlbum";
import { useBoolSetting, useSetting } from "../hooks/useSetting";
import { useGenreMappings } from "../hooks/useGenreDisplay";
import { getCoverArtUrl } from "../clients/navidromeUrls";
import { useAlbumAccent } from "../hooks/useAlbumAccent";
import { syncAlbumTracks } from "../features/sync/syncTracks";
import { fetchAlbumTracks } from "../lib/albumTracks";
import { useMissingTracksRepair } from "../hooks/useMissingTracksRepair";
import { makeStreamUrlBuilder } from "../lib/track";
import type { CurrentTrack } from "../features/playback/store/playerTypes";
import { useStartRadio } from "../features/radio/hooks/useStartRadio";
import { usePlayerStore } from "../features/playback/store/player";
import {
  buildDisplayGenres,
  groupGenresBySource,
  trackGenres,
  useRawSourcesByCanonicalId,
  useTrackTagGenres,
  useUnmatchedGenreCount,
} from "./album/albumGenres";
import { AlbumHero } from "./album/AlbumHero";
import { AlbumTagBand } from "./album/AlbumTagBand";
import { AlbumBio } from "./album/AlbumBio";
import { AlbumTrackList } from "./album/AlbumTrackList";
import { TrackContextMenu } from "./album/TrackContextMenu";
import "./AlbumDetail.css";

const RELATED_SHELF_LIMIT = 6;

interface Props {
  album: AlbumRow;
  serverWithCredential: ServerWithCredential;
  onClose: () => void;
  onSelectAlbum?: (album: AlbumRow) => void;
  onSelectArtist?: (artistName: string) => void;
  onTagFilter?: (canonicalId: string) => void;
}

interface DrawerState {
  albumId: string;
  trackId?: string;
}

export function AlbumDetail({ album, serverWithCredential, onClose, onSelectAlbum, onSelectArtist, onTagFilter }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: tracks, isLoading, error: tracksError } = useTracks(album.id);
  const { lovedTrackIds, toggleTrackLove, lovedAlbumIds, toggleAlbumLove } = useLoved();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const addManyToQueue = usePlayerStore((s) => s.addManyToQueue);
  const playNextMany = usePlayerStore((s) => s.playNextMany);
  const startRadio = useStartRadio();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const queryClient = useQueryClient();
  const { data: playlists, addTrackToPlaylist } = usePlaylists();
  const { data: normalizedTags } = useNormalizeAlbum(album.id, album.artist ?? "", album.name);
  useEnrichAlbumTracks(album.id, album.artist ?? "", album.name);
  const { data: albumEnrichment } = useEnrichAlbum(album.id, album.artist ?? "", album.name);
  const genreMappings = useGenreMappings();

  const isVariousArtists = (album.artist ?? "").trim().toLowerCase() === "various artists";
  const { data: moreFromArtist } = useArtistAlbums(isVariousArtists ? "" : album.artist ?? "", server.id);
  const moreFromArtistAlbums = useMemo(
    () => (moreFromArtist ?? []).filter((a) => a.id !== album.id).slice(0, RELATED_SHELF_LIMIT),
    [moreFromArtist, album.id]
  );
  const { data: artistEnrichment } = useEnrichArtist(isVariousArtists ? "" : album.artist ?? "");
  const similarArtistNames = useMemo<string[]>(
    () => (artistEnrichment?.similar_json ? (JSON.parse(artistEnrichment.similar_json) as string[]) : []),
    [artistEnrichment?.similar_json]
  );
  const { data: similarInLibrarySet } = useSimilarInLibrary(similarArtistNames);
  const similarArtistNamesInLibrary = useMemo(
    () => similarArtistNames.filter((n) => similarInLibrarySet?.has(n)),
    [similarArtistNames, similarInLibrarySet]
  );
  const { data: fansAlsoLikeAlbumsRaw = [] } = useSimilarArtistAlbums(similarArtistNamesInLibrary, server.id);
  const fansAlsoLikeAlbums = useMemo(
    () => fansAlsoLikeAlbumsRaw.slice(0, RELATED_SHELF_LIMIT),
    [fansAlsoLikeAlbumsRaw]
  );

  const trackTagGenresMap = useTrackTagGenres(album.id, genreMappings);

  const { data: albumIdentity, isSuccess: identityLoaded } = useAlbumIdentity(album.id);
  const [mbAutoIdentify] = useBoolSetting("mb.auto_identify", true);

  const [isTagRefreshing, setIsTagRefreshing] = useState(false);
  const [tagRefreshError, setTagRefreshError] = useState<string | null>(null);

  const doSyncTracks = useCallback(async () => {
    await syncAlbumTracks(serverWithCredential.server, serverWithCredential.credential, album.id);
    useTrackListSessionStore.getState().bumpRefresh();
  }, [album.id, serverWithCredential]);

  // Auto-sync when all tracks are missing bit_rate, leftover from v32 migration.
  // Guarded to one attempt per album: doSyncTracks bumps the track-list refresh tick,
  // which makes useTracks hand back a fresh array and re-run this effect. If the server
  // reports no bitRate for these tracks, the condition is still true on that new array,
  // so without the guard this re-syncs the album over the network forever.
  const bitRateSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tracks || tracks.length === 0) return;
    if (bitRateSyncedRef.current === album.id) return;
    if (tracks.every((t) => t.bit_rate === null)) {
      bitRateSyncedRef.current = album.id;
      void doSyncTracks();
    }
  }, [tracks, doSyncTracks, album.id]);

  const fetchMissingTracks = useCallback(async () => {
    await fetchAlbumTracks(serverWithCredential.server, serverWithCredential.credential, album.id);
    useTrackListSessionStore.getState().bumpRefresh();
  }, [album.id, serverWithCredential]);
  const missingTracks = useMissingTracksRepair({
    albumId: album.id,
    tracks,
    isLoading,
    error: tracksError,
    fetchTracks: fetchMissingTracks,
  });

  const refreshTags = useCallback(async () => {
    if (isTagRefreshing) return;
    setIsTagRefreshing(true);
    setTagRefreshError(null);
    try {
      await doSyncTracks();
      await normalizeAlbum(album.id, album.artist ?? "", album.name, {
        lastfmArtistName: albumIdentity?.lastfm_artist_name ?? null,
        lastfmAlbumName: albumIdentity?.lastfm_album_name ?? null,
        combinedMbGenres: albumIdentity?.combined_genres_json
          ? (JSON.parse(albumIdentity.combined_genres_json) as Array<{ name: string; count: number }>)
          : null,
        combinedMbTags: albumIdentity?.combined_tags_json
          ? (JSON.parse(albumIdentity.combined_tags_json) as Array<{ name: string; count: number }>)
          : null,
      });
      await queryClient.invalidateQueries({ queryKey: QK.normalizedTags(album.id) });
      await queryClient.invalidateQueries({ queryKey: QK.albumUnmatchedGenres(album.id) });
    } catch (err) {
      console.error("AlbumDetail: tag refresh failed", err);
      setTagRefreshError("Refresh failed. Check the server connection and try again.");
    } finally {
      setIsTagRefreshing(false);
    }
  }, [album.id, album.artist, album.name, albumIdentity, isTagRefreshing, queryClient, doSyncTracks]);
  const [playAction] = useSetting("album.play_action", "replace");

  const saveIdentity = useSaveAlbumIdentity();
  const recordFailed = useRecordFailedLookup();

  const { data: confirmedArtistMbid } = useConfirmedArtistMbid(album.artist ?? "");

  const { data: autoResult, isFetching: autoIdentifyFetching } = useAutoIdentifyAlbum({
    albumId: album.id,
    artist: album.artist ?? "",
    album: album.name,
    trackCount: tracks?.length ?? 0,
    year: album.year,
    confirmedArtistMbid,
    mbAutoIdentify,
    existingIdentity: albumIdentity,
    identityLoaded,
  });

  useEffect(() => {
    if (!autoResult) return;
    const { decision, score, detail, release, combinedGenres, combinedTags } = autoResult;

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
        combinedTags,
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
  const [drawerState, setDrawerState] = useState<DrawerState | null>(null);
  const [showIdentify, setShowIdentify] = useState(false);
  const [showGenreEditor, setShowGenreEditor] = useState(false);
  const albumBio = albumEnrichment?.album_bio ?? null;

  const coverArtUrl = album.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 500)
    : null;

  const accentColor = useAlbumAccent(album.id, album.accent_color, coverArtUrl, server.id);

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
      replayGain: (track.replay_gain_track_gain != null || track.replay_gain_album_gain != null)
        ? {
            trackGain: track.replay_gain_track_gain,
            trackPeak: track.replay_gain_track_peak,
            albumGain: track.replay_gain_album_gain,
            albumPeak: track.replay_gain_album_peak,
          }
        : null,
    };
  }

  const streamUrlFor = useMemo(() => makeStreamUrlBuilder(server, credential), [server, credential]);

  function handlePlayTrack(track: TrackRow) {
    if (!tracks) return;
    const startIndex = tracks.findIndex((t) => t.id === track.id);
    playQueue(tracks.map(buildTrackObj), streamUrlFor, startIndex >= 0 ? startIndex : 0);
  }

  function handlePlayAlbum() {
    if (!tracks || tracks.length === 0) return;
    const trackObjs = tracks.map(buildTrackObj);
    if (playAction === "queue_last") {
      addManyToQueue(trackObjs, streamUrlFor);
    } else if (playAction === "queue_next") {
      playNextMany(trackObjs, streamUrlFor);
    } else if (playAction === "shuffle") {
      void playQueue(shuffleArray(trackObjs), streamUrlFor, 0);
    } else {
      void playQueue(trackObjs, streamUrlFor, 0);
    }
  }

  const rawSourcesByCanonicalId = useRawSourcesByCanonicalId(album.id);
  const displayGenres = useMemo(
    () => buildDisplayGenres(normalizedTags, tracks, genreMappings),
    [normalizedTags, tracks, genreMappings]
  );
  const genreGroups = useMemo(() => groupGenresBySource(displayGenres), [displayGenres]);
  const unmatchedCount = useUnmatchedGenreCount(album.id);
  const isAlbumLoved = lovedAlbumIds.has(album.id);

  return (
    <div
      className="album-detail"
      style={(accentColor ? { "--album-accent": accentColor } : {}) as React.CSSProperties}
    >
      <AlbumHero
        album={album}
        coverArtUrl={coverArtUrl}
        albumIdentity={albumIdentity}
        showUnidentified={mbAutoIdentify && identityLoaded && !autoIdentifyFetching}
        tagsComputedAt={normalizedTags?.computed_at ?? null}
        tagRefresh={{ isRefreshing: isTagRefreshing, error: tagRefreshError, onRefresh: () => { void refreshTags(); } }}
        playAction={playAction}
        canPlay={!!tracks && tracks.length > 0}
        onPlayAlbum={handlePlayAlbum}
        isLoved={isAlbumLoved}
        onToggleLove={() => toggleAlbumLove(album.id, serverWithCredential)}
        onIdentify={() => setShowIdentify(true)}
        onClose={onClose}
        onSelectArtist={onSelectArtist}
      />

      <AlbumTagBand
        displayGenres={displayGenres}
        normalizedTags={normalizedTags}
        rawSourcesByCanonicalId={rawSourcesByCanonicalId}
        unmatchedCount={unmatchedCount}
        showGenreEditor={showGenreEditor}
        onToggleGenreEditor={() => setShowGenreEditor((v) => !v)}
        onOpenGenreEditor={() => setShowGenreEditor(true)}
        onTagFilter={onTagFilter}
        onOpenDrawer={() => setDrawerState({ albumId: album.id })}
      />

      {showGenreEditor && (
        <AlbumGenreEditor
          albumId={album.id}
          albumArtist={album.artist ?? ""}
          albumName={album.name}
          genreGroups={genreGroups}
          rawSourcesByCanonicalId={rawSourcesByCanonicalId}
          onTagFilter={onTagFilter}
          onClose={() => setShowGenreEditor(false)}
        />
      )}

      <div className="album-detail-body">
        {albumBio && <AlbumBio bio={albumBio} />}
        <AlbumTrackList
          tracks={tracks}
          isLoading={isLoading}
          tracksError={tracksError}
          missingTracks={missingTracks}
          trackTagGenresMap={trackTagGenresMap}
          genreMappings={genreMappings}
          currentTrackId={currentTrack?.id ?? null}
          isPlaying={isPlaying}
          lovedTrackIds={lovedTrackIds}
          onToggleLove={(trackId) => void toggleTrackLove(trackId, serverWithCredential)}
          onPlayTrack={handlePlayTrack}
          onContextMenu={(e, track) => setContextMenu({ x: e.clientX, y: e.clientY, track })}
        />

        {moreFromArtistAlbums.length > 0 && (
          <section className="album-related-section">
            <h3 className="album-related-title">More from {album.artist}</h3>
            <AlbumGrid
              albums={moreFromArtistAlbums}
              serverWithCredential={serverWithCredential}
              onSelect={(a) => onSelectAlbum?.(a)}
            />
          </section>
        )}

        {fansAlsoLikeAlbums.length > 0 && (
          <section className="album-related-section">
            <h3 className="album-related-title">Fans Also Like</h3>
            <AlbumGrid
              albums={fansAlsoLikeAlbums}
              serverWithCredential={serverWithCredential}
              onSelect={(a) => onSelectAlbum?.(a)}
            />
          </section>
        )}
      </div>

      {contextMenu && (
        <TrackContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isLoved={lovedTrackIds.has(contextMenu.track.id)}
          overflowGenres={trackGenres(contextMenu.track, trackTagGenresMap, genreMappings).slice(3)}
          playlists={playlists}
          onClose={() => setContextMenu(null)}
          onPlayNow={() => handlePlayTrack(contextMenu.track)}
          onPlayNext={() => playNext(buildTrackObj(contextMenu.track), streamUrlFor)}
          onAddToQueue={() => addToQueue(buildTrackObj(contextMenu.track), streamUrlFor)}
          onStartRadio={(mode) => {
            const track = buildTrackObj(contextMenu.track);
            void startRadio({ tracks: [track], streamUrlFor, mode });
          }}
          onToggleLove={() => void toggleTrackLove(contextMenu.track.id, serverWithCredential)}
          onShowTags={() => setDrawerState({ albumId: album.id, trackId: contextMenu.track.id })}
          onTagFilter={onTagFilter}
          onAddToPlaylist={(pl) => void addTrackToPlaylist(pl, contextMenu.track.id, serverWithCredential)}
        />
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
          trackCount={tracks?.length ?? 0}
          year={album.year}
          confirmedArtistMbid={confirmedArtistMbid}
          onClose={() => setShowIdentify(false)}
        />
      )}
    </div>
  );
}
