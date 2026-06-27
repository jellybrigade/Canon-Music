import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAlbumDisplayName, useAlbumSuffixAllowlist, useAlbumSuffixExclusions, extractSuffix } from "../hooks/useAlbumDisplayName";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { Heart, Play, ChevronRight, Disc, HelpCircle, Pencil, SlidersHorizontal, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ContextMenu, ContextMenuSubmenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import { TagDrawer } from "./TagDrawer";
import { AlbumGenreEditor } from "./AlbumGenreEditor";
import type { DisplayGenre, GenreGroups } from "./AlbumGenreEditor";
import { AlbumIdentifyDialog } from "./IdentifyDialog";
import type { AlbumRow, TrackRow } from "../types/library";
import type { ServerWithCredential } from "../hooks/useServer";
import { useTracks } from "../hooks/useTracks";
import { useLoved } from "../hooks/useLoved";
import { usePlaylists } from "../hooks/usePlaylists";
import { useNormalizeAlbum } from "../hooks/useNormalizeAlbum";
import { useEnrichAlbumTracks } from "../hooks/useEnrichAlbumTracks";
import { normalizeAlbum } from "../lib/tag-normalize";
import { useAlbumIdentity, useSaveAlbumIdentity, useRecordFailedLookup } from "../hooks/useAlbumIdentity";
import { useAutoIdentifyAlbum } from "../hooks/useAutoIdentifyAlbum";
import { useBoolSetting, useSetting } from "../hooks/useSetting";
import { useGenreMappings, applyGenreMappings } from "../hooks/useGenreDisplay";
import { getDb } from "../db";
import { getCoverArtUrl } from "../lib/navidrome";
import { extractAccent } from "../lib/artColor";
import { syncAlbumTracks } from "../lib/sync";
import { makeStreamUrlBuilder } from "../lib/track";
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

  const albumDisplayName = useAlbumDisplayName();
  const [suffixAllowlist, addToSuffixAllowlist] = useAlbumSuffixAllowlist();
  const [suffixExcludedIds, excludeFromSuffix, unexcludeFromSuffix] = useAlbumSuffixExclusions();
  const [showFullTitle, setShowFullTitle] = useState(false);
  const [showAlbumSuffixes] = useBoolSetting("display.show_album_suffixes", true);
  const strippingEnabled = !showAlbumSuffixes;
  const detectedSuffix = extractSuffix(album.name);
  const suffixIsExcluded = suffixExcludedIds.includes(album.id);
  const suffixWasStripped = !suffixIsExcluded && albumDisplayName(album.name, album.id) !== album.name;
  const suffixCanBeAdded = strippingEnabled && detectedSuffix !== null && !suffixWasStripped &&
    !suffixAllowlist.some((s) => s.toLowerCase() === detectedSuffix.toLowerCase());
  const queryClient = useQueryClient();
  const { data: playlists, addTrackToPlaylist } = usePlaylists();
  const { data: normalizedTags } = useNormalizeAlbum(album.id, album.artist ?? "", album.name);
  useEnrichAlbumTracks(album.id, album.artist ?? "", album.name);
  const genreMappings = useGenreMappings();

  const { data: trackTagRows = [] } = useQuery({
    queryKey: QK.trackTagsAlbum(album.id),
    queryFn: async () => {
      const db = await getDb();
      return db.select<{ track_id: string; raw_value: string; canonical_id: string | null; source: string }[]>(
        `SELECT tt.track_id, tt.raw_value, tt.canonical_id, tt.source
         FROM track_tags tt
         JOIN tracks t ON tt.track_id = t.id
         WHERE t.album_id = ? AND tt.kind = 'genre'
         ORDER BY tt.track_id,
                  CASE tt.source WHEN 'server' THEN 0 WHEN 'lastfm-track' THEN 1 ELSE 2 END`,
        [album.id]
      );
    },
    staleTime: Infinity,
  });

  const trackTagGenresMap = useMemo(() => {
    const map = new Map<string, { display: string; canonicalId: string }[]>();
    for (const row of trackTagRows) {
      const display = genreMappings.has(row.raw_value)
        ? (genreMappings.get(row.raw_value) ?? null)
        : row.raw_value;
      if (display === null) continue;
      if (!map.has(row.track_id)) map.set(row.track_id, []);
      const genres = map.get(row.track_id)!;
      if (!genres.some((g) => g.display === display)) {
        genres.push({ display, canonicalId: row.canonical_id ?? rawGenreId(row.raw_value) });
      }
    }
    return map;
  }, [trackTagRows, genreMappings]);

  const { data: albumIdentity, isSuccess: identityLoaded } = useAlbumIdentity(album.id);
  const [mbAutoIdentify] = useBoolSetting("mb.auto_identify", false);

  const [isTagRefreshing, setIsTagRefreshing] = useState(false);

  const doSyncTracks = useCallback(async () => {
    await syncAlbumTracks(serverWithCredential.server, serverWithCredential.credential, album.id);
    await queryClient.invalidateQueries({ queryKey: QK.tracks(album.id) });
  }, [album.id, serverWithCredential, queryClient]);

  // Auto-sync when all tracks are missing bit_rate — leftover from v32 migration
  useEffect(() => {
    if (!tracks || tracks.length === 0) return;
    if (tracks.every((t) => t.bit_rate === null)) {
      void doSyncTracks();
    }
  }, [tracks, doSyncTracks]);

  const refreshTags = useCallback(async () => {
    if (isTagRefreshing) return;
    setIsTagRefreshing(true);
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
    } catch {
      // silent
    } finally {
      setIsTagRefreshing(false);
    }
  }, [album.id, album.artist, album.name, albumIdentity, isTagRefreshing, queryClient, doSyncTracks]);
  const [playAction] = useSetting("album.play_action", "replace");

  const saveIdentity = useSaveAlbumIdentity();
  const recordFailed = useRecordFailedLookup();

  const { data: autoResult, isFetching: autoIdentifyFetching } = useAutoIdentifyAlbum({
    albumId: album.id,
    artist: album.artist ?? "",
    album: album.name,
    trackCount: tracks?.length ?? 0,
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
  const [contextMenuMode, setContextMenuMode] = useState<"main" | "playlist">("main");
  const [drawerState, setDrawerState] = useState<DrawerState | null>(null);
  const [showIdentify, setShowIdentify] = useState(false);

  const [trackCols, setTrackCols] = useState<{
    artist: boolean; genre: boolean; disc: boolean;
    duration: boolean; format: boolean; bitrate: boolean; plays: boolean;
  }>(() => {
    const defaults = { artist: true, genre: true, disc: false, duration: true, format: false, bitrate: false, plays: true };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem("canon-album-track-cols") ?? "null") }; }
    catch { return defaults; }
  });
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("canon-album-track-cols", JSON.stringify(trackCols));
  }, [trackCols]);

  useEffect(() => {
    if (!showColPicker) return;
    const close = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) setShowColPicker(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showColPicker]);

  const [showGenreEditor, setShowGenreEditor] = useState(false);

  const coverArtUrl = album.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 500)
    : null;

  const [accentColor, setAccentColor] = useState<string | null>(null);
  useEffect(() => {
    if (!coverArtUrl) { setAccentColor(null); return; }
    let cancelled = false;
    void extractAccent(coverArtUrl).then((color) => { if (!cancelled) setAccentColor(color); });
    return () => { cancelled = true; };
  }, [coverArtUrl]);

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

  const streamUrlFor = makeStreamUrlBuilder(server, credential);

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

  const { data: rawSourceRows = [] } = useQuery({
    queryKey: QK.albumGenreRawSources(album.id),
    queryFn: async () => {
      const db = await getDb();
      return db.select<{ canonical_id: string; raw_value: string; source: string }[]>(
        `SELECT DISTINCT tt.canonical_id, tt.raw_value, tt.source
         FROM tracks t JOIN track_tags tt ON tt.track_id = t.id
         WHERE t.album_id = ? AND tt.kind = 'genre'`,
        [album.id]
      );
    },
    staleTime: Infinity,
  });

  const rawSourcesByCanonicalId = useMemo(() => {
    const map = new Map<string, Array<{ raw_value: string; source: string }>>();
    for (const r of rawSourceRows) {
      if (!map.has(r.canonical_id)) map.set(r.canonical_id, []);
      map.get(r.canonical_id)!.push({ raw_value: r.raw_value, source: r.source });
    }
    return map;
  }, [rawSourceRows]);

  const displayGenres = useMemo((): DisplayGenre[] => {
    let raw: DisplayGenre[];
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
    // Drop unmapped tags (id=null) that have no decision yet (undecided unmatched),
    // are ignored, or whose mapped name is already shown as a canonical chip.
    const shownNames = new Set(raw.filter((g) => g.id !== null).map((g) => g.name));
    return raw.filter((g) => {
      if (g.id !== null) return true;
      const mapped = genreMappings.get(g.name);
      if (mapped === undefined) return false; // no decision yet — hide from band
      if (mapped === null) return false;      // ignored
      if (shownNames.has(mapped)) return false; // already shown as canonical
      return true;
    });
  }, [normalizedTags, tracks, genreMappings]);

  const genreGroups = useMemo((): GenreGroups => {
    const manual: DisplayGenre[] = [];
    const file: DisplayGenre[] = [];
    const lastfm: DisplayGenre[] = [];
    const musicbrainz: DisplayGenre[] = [];
    const folksonomy: DisplayGenre[] = [];
    const unsourced: DisplayGenre[] = [];
    for (const g of displayGenres) {
      if (g.source === "manual") manual.push(g);
      else if (g.source === "file") file.push(g);
      else if (g.source === "lastfm") lastfm.push(g);
      else if (g.source === "musicbrainz") musicbrainz.push(g);
      else if (g.source === "musicbrainz-folksonomy") folksonomy.push(g);
      else unsourced.push(g);
    }
    const nonEmpty = [manual, file, lastfm, musicbrainz, folksonomy, unsourced].filter((g) => g.length > 0);
    return { manual, file, lastfm, musicbrainz, folksonomy, unsourced, multiSource: nonEmpty.length > 1 };
  }, [displayGenres]);

  // Same query key + shape as TagDrawer's useAlbumUnmatchedGenres so the cache is shared.
  const { data: unmatchedGenres = [] } = useQuery({
    queryKey: QK.albumUnmatchedGenres(album.id),
    queryFn: async () => {
      const db = await getDb();
      return db.select<{ raw_value: string; source: string }[]>(
        `SELECT DISTINCT ug.raw_value, ug.source
         FROM album_unresolved_genres ug
         WHERE ug.album_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM tag_mappings tm
             WHERE tm.raw_value = ug.raw_value AND tm.kind = 'genre'
           )
         ORDER BY ug.source, ug.raw_value`,
        [album.id]
      );
    },
    staleTime: Infinity,
  });
  const unmatchedCount = unmatchedGenres.length;

  // Always true — every synced album can have user genres added
  const hasTags = true;

  return (
    <div
      className="album-detail"
      style={(accentColor ? { "--album-accent": accentColor } : {}) as React.CSSProperties}
    >
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
            <div className="album-detail-title-row">
              <h2 className="album-detail-title">
                {showFullTitle ? album.name : albumDisplayName(album.name, album.id)}
              </h2>
              {suffixWasStripped && (
                <button
                  className="album-suffix-toggle-btn"
                  onClick={() => setShowFullTitle((v) => !v)}
                  title={showFullTitle ? "Hide full title" : "Show full title"}
                >
                  {showFullTitle ? "Hide" : "···"}
                </button>
              )}
              {suffixWasStripped && showFullTitle && detectedSuffix && (
                <button
                  className="album-suffix-toggle-btn"
                  onClick={() => { void excludeFromSuffix(album.id); setShowFullTitle(false); }}
                  title="Keep the suffix visible for this album only."
                >
                  Keep
                </button>
              )}
            </div>
            {suffixCanBeAdded && detectedSuffix && (
              <button
                className="album-suffix-add-btn"
                onClick={() => void addToSuffixAllowlist(detectedSuffix)}
                title="Strips this parenthetical from all albums. Manage in Tags › Title Cleanup."
              >
                + Strip "({detectedSuffix})" from all albums
              </button>
            )}
            {suffixIsExcluded && detectedSuffix && (
              <button
                className="album-suffix-add-btn album-suffix-add-btn--undo"
                onClick={() => void unexcludeFromSuffix(album.id)}
                title="Re-apply suffix stripping to this album."
              >
                ↩ Strip "({detectedSuffix})" again
              </button>
            )}
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
            ) : mbAutoIdentify && identityLoaded && !autoIdentifyFetching ? (
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
              {albumIdentity?.confirmed_at && albumIdentity.mb_release_id && (
                <button
                  className="album-identify-btn"
                  onClick={() => void openUrl(`https://musicbrainz.org/release/${albumIdentity.mb_release_id}`)}
                  aria-label="Open on MusicBrainz"
                  title="Open on MusicBrainz"
                >
                  <ExternalLink size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {hasTags && (
        <section className="album-tag-band" aria-label="Album tags">
          {(() => {
            const renderGenreChip = (tag: DisplayGenre) => {
              const rawSources = tag.id ? (rawSourcesByCanonicalId.get(tag.id) ?? []) : [];
              const chipTitle = rawSources.length > 0
                ? rawSources.map((r) => `"${r.raw_value}" (${r.source === "server" ? "file" : r.source})`).join(", ")
                : tag.source ?? undefined;
              const sourceClass = tag.source ? ` album-tag-chip--${tag.source}` : "";
              return (
                <button
                  key={tag.id ?? tag.name}
                  className={`album-tag-chip${sourceClass}`}
                  title={chipTitle}
                  onClick={() => onTagFilter?.(tag.id !== null ? tag.id : rawGenreId(tag.name))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setDrawerState({ albumId: album.id });
                  }}
                >
                  {tag.name}
                </button>
              );
            };

            return (
              <div className="album-tag-column">
                <div className="album-tag-column-header">
                  <h3 className="album-tag-column-title" title="Genre tags aggregated from track files and enrichment services (Last.fm, MusicBrainz)">Genres</h3>
                  <button
                    className="album-tag-add-genre-btn"
                    onClick={() => setShowGenreEditor((v) => !v)}
                    title={showGenreEditor ? "Close genre editor" : "Edit genres"}
                  >
                    <Pencil size={10} />
                  </button>
                </div>

                {displayGenres.map(renderGenreChip)}

                {unmatchedCount > 0 && !showGenreEditor && (
                  <button
                    className="album-unmatched-hint"
                    onClick={() => setShowGenreEditor(true)}
                    title="Open genre editor to map unmatched genres"
                  >
                    {unmatchedCount} unmatched →
                  </button>
                )}
              </div>
            );
          })()}
          {normalizedTags && normalizedTags.descriptors.length > 0 && (
            <div className="album-tag-column">
              <h3 className="album-tag-column-title" title="Mood and style descriptors from enrichment services">Descriptors</h3>
              {normalizedTags.descriptors.map((tag) => {
                const rawSources = tag.id ? (rawSourcesByCanonicalId.get(tag.id) ?? []) : [];
                const chipTitle = rawSources.length > 0
                  ? rawSources.map((r) => `"${r.raw_value}" (${r.source === "server" ? "file" : r.source})`).join(", ")
                  : undefined;
                const sourceClass = tag.source ? ` album-tag-chip--${tag.source}` : "";
                return (
                  <button
                    key={tag.id ?? tag.name}
                    className={`album-tag-chip${sourceClass}`}
                    title={chipTitle}
                    onClick={() => onTagFilter?.(tag.id !== null ? tag.id : rawGenreId(tag.name))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setDrawerState({ albumId: album.id });
                    }}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
          {normalizedTags && normalizedTags.scenes.length > 0 && (
            <div className="album-tag-column">
              <h3 className="album-tag-column-title" title="Musical scenes, movements and subgenre contexts">Scenes & Movements</h3>
              {normalizedTags.scenes.map((tag) => {
                const rawSources = tag.id ? (rawSourcesByCanonicalId.get(tag.id) ?? []) : [];
                const chipTitle = rawSources.length > 0
                  ? rawSources.map((r) => `"${r.raw_value}" (${r.source === "server" ? "file" : r.source})`).join(", ")
                  : undefined;
                const sourceClass = tag.source ? ` album-tag-chip--${tag.source}` : "";
                return (
                  <button
                    key={tag.id ?? tag.name}
                    className={`album-tag-chip${sourceClass}`}
                    title={chipTitle}
                    onClick={() => onTagFilter?.(tag.id !== null ? tag.id : rawGenreId(tag.name))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setDrawerState({ albumId: album.id });
                    }}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

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
        {isLoading ? (
          <p className="empty-state">Loading tracks…</p>
        ) : !tracks || tracks.length === 0 ? (
          <p className="empty-state">No tracks synced yet.</p>
        ) : (
          <div className="tracklist-wrapper">
            <div className="tracklist-col-picker-anchor" ref={colPickerRef}>
              <button
                className="tracklist-col-picker-btn"
                title="Show/hide columns"
                onClick={() => setShowColPicker((v) => !v)}
              >
                <SlidersHorizontal size={13} />
              </button>
              {showColPicker && (
                <div className="tracklist-col-picker-popup">
                  {(
                    [
                      ["artist", "Artist"],
                      ["genre", "Genre"],
                      ["disc", "Disc #"],
                      ["duration", "Duration"],
                      ["format", "Format"],
                      ["bitrate", "Bitrate"],
                      ["plays", "Play count"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={trackCols[key]}
                        onChange={(e) => setTrackCols((c) => ({ ...c, [key]: e.target.checked }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <table className="tracklist">
              <tbody>
                {tracks.map((track) => {
                  const isCurrentlyPlaying = currentTrack?.id === track.id && isPlaying;
                  const isCurrentTrack = currentTrack?.id === track.id;
                  const allTrackGenres: { display: string; canonicalId: string }[] =
                    trackTagGenresMap.get(track.id) ??
                    applyGenreMappings(track.genre, genreMappings).map((g) => ({
                      display: g,
                      canonicalId: rawGenreId(g),
                    }));
                  const trackGenres = allTrackGenres.slice(0, 3);
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
                      {trackCols.artist && <td className="track-artist">{track.artist ?? ""}</td>}
                      {trackCols.genre && (
                        <td className="track-genre">
                          {trackGenres.map((g, i) => (
                            <span key={i} className="track-genre-chip">{g.display}</span>
                          ))}
                        </td>
                      )}
                      {trackCols.disc && <td className="track-disc">{track.disc_number ?? ""}</td>}
                      {trackCols.duration && (
                        <td className="track-duration">
                          {track.duration ? formatDuration(track.duration) : ""}
                        </td>
                      )}
                      {trackCols.format && (
                        <td className="track-format">{track.suffix ? track.suffix.toUpperCase() : ""}</td>
                      )}
                      {trackCols.bitrate && (
                        <td className="track-bitrate">{track.bit_rate ? `${track.bit_rate}k` : ""}</td>
                      )}
                      {trackCols.plays && (
                        <td className="track-plays">{track.play_count ?? ""}</td>
                      )}
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
          </div>
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
              {(() => {
                const allGenres =
                  trackTagGenresMap.get(contextMenu.track.id) ??
                  applyGenreMappings(contextMenu.track.genre, genreMappings).map((g) => ({
                    display: g,
                    canonicalId: rawGenreId(g),
                  }));
                const overflow = allGenres.slice(3);
                return overflow.length > 0 ? (
                  <ContextMenuSubmenu label="More genres">
                    {overflow.map((g) => (
                      <button
                        key={g.canonicalId}
                        onClick={() => {
                          onTagFilter?.(g.canonicalId);
                          setContextMenu(null);
                        }}
                      >
                        {g.display}
                      </button>
                    ))}
                  </ContextMenuSubmenu>
                ) : null;
              })()}
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
          trackCount={tracks?.length ?? 0}
          onClose={() => setShowIdentify(false)}
        />
      )}
    </div>
  );
}
