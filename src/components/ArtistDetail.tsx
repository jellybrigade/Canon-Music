import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { Play, Shuffle, Radio, Disc, ExternalLink, GitMerge, MoreHorizontal, ChevronDown } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getDb } from "../db";
import { AlbumGrid } from "./AlbumGrid";
import { ArtistIdentifyDialog } from "./IdentifyDialog";
import { ArtistMergeModal } from "./ArtistMergeModal";
import { ContextMenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import type { ArtistRow, AlbumRow } from "../types/library";
import type { ServerWithCredential } from "../hooks/useServer";
import type { Server } from "../types/server";
import type { NavidromeCredential } from "../lib/navidrome";
import type { CurrentTrack } from "../store/player";
import { usePlayerStore } from "../store/player";
import { getCoverArtUrl } from "../lib/navidrome";
import { makeStreamUrlBuilder } from "../lib/track";
import { fetchArtistTopTracks, fetchArtistTopAlbums, normalizeTrackTitle, LASTFM_PLACEHOLDER } from "../lib/lastfm";
import { shuffleArray } from "../lib/shuffle";
import type { LastfmTopTrack, LastfmTopAlbum } from "../lib/lastfm";
import { useEnrichArtist } from "../hooks/useEnrichArtist";
import { useArtistAlbums } from "../hooks/useArtistAlbums";
import { useSimilarInLibrary } from "../hooks/useSimilarInLibrary";
import { useLoved } from "../hooks/useLoved";
import { useArtistCanonicalOf, useAliasesOfCanonical, useRemoveArtistAlias } from "../hooks/useArtistAliases";
import { useBoolSetting } from "../hooks/useSetting";
import { fetchBandsintownEvents, type BandsintownEvent } from "../lib/bandsintown";
import { TourCard } from "./TourCard";
import "./ArtistDetail.css";

interface Props {
  artist: ArtistRow;
  serverWithCredential: ServerWithCredential;
  onClose: () => void;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist?: (artistName: string) => void;
}

interface TopTrack {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  album_name: string | null;
  album_id: string | null;
  artwork_url: string | null;
  play_count: number | null;
}

function useArtistTopTracks(artistName: string) {
  return useQuery({
    queryKey: QK.artistTopTracks(artistName),
    queryFn: async (): Promise<TopTrack[]> => {
      const db = await getDb();
      return db.select<TopTrack[]>(
        `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                t.album_id, a.artwork_url, t.play_count
         FROM tracks t
         LEFT JOIN albums a ON t.album_id = a.id
         WHERE t.artist = ?
            OR t.artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?)
         ORDER BY t.track_number, t.title
         LIMIT 30`,
        [artistName, artistName]
      );
    },
  });
}

function useArtistGenres(artistName: string) {
  return useQuery({
    queryKey: QK.artistGenres(artistName),
    queryFn: async (): Promise<string[]> => {
      const db = await getDb();
      const rows = await db.select<{ name: string }[]>(
        `SELECT ag.name, COUNT(DISTINCT ag.album_id) AS n
         FROM album_genres ag
         JOIN albums a ON a.id = ag.album_id
         WHERE (a.artist = ? OR a.artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?))
           AND ag.relation = 'direct'
           AND ag.canonical_id NOT LIKE 'raw:%'
         GROUP BY ag.canonical_id
         ORDER BY n DESC
         LIMIT 5`,
        [artistName, artistName]
      );
      return rows.map((r) => r.name);
    },
    enabled: !!artistName,
  });
}

function useAppearsOnAlbums(artistName: string) {
  return useQuery({
    queryKey: QK.artistAppearsOn(artistName),
    queryFn: async (): Promise<AlbumRow[]> => {
      const db = await getDb();
      return db.select<AlbumRow[]>(
        `SELECT DISTINCT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url, a.release_type
         FROM tracks t
         JOIN albums a ON t.album_id = a.id
         WHERE (t.artist = ? OR t.artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?))
           AND a.artist IS NOT NULL
           AND a.artist != ?
           AND a.artist NOT IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?)
         ORDER BY a.year IS NULL, a.year DESC, a.name
         LIMIT 24`,
        [artistName, artistName, artistName, artistName]
      );
    },
    enabled: !!artistName,
  });
}

function useLastfmTopAlbums(artistName: string) {
  return useQuery({
    queryKey: QK.lastfmArtistTopAlbums(artistName),
    queryFn: (): Promise<LastfmTopAlbum[]> => fetchArtistTopAlbums(artistName),
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });
}

function useLastfmTopTracks(artistName: string) {
  return useQuery({
    queryKey: QK.lastfmArtistTopTracks(artistName),
    queryFn: (): Promise<LastfmTopTrack[]> => fetchArtistTopTracks(artistName),
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });
}

type ReleaseGroup = "album" | "ep" | "single" | "compilation";

function classifyRelease(name: string, releaseType?: string | null | undefined): ReleaseGroup {
  if (releaseType) {
    const rt = releaseType.toLowerCase();
    if (rt === "single") return "single";
    if (rt === "ep") return "ep";
    if (rt === "compilation" || rt === "live" || rt === "remix") return "compilation";
    if (rt === "album") return "album";
  }
  const n = name.toLowerCase().trim();
  if (/\bsingle\b|-\s*single\s*$/.test(n)) return "single";
  if (/\bep\b|-\s*ep\s*$/.test(n)) return "ep";
  if (/compilation|greatest hits|best of\b|anthology|the collection|box set/.test(n)) return "compilation";
  return "album";
}

function groupAlbums(albums: AlbumRow[]): { group: ReleaseGroup; label: string; items: AlbumRow[] }[] {
  const map: Record<ReleaseGroup, AlbumRow[]> = { album: [], ep: [], single: [], compilation: [] };
  for (const a of albums) map[classifyRelease(a.name, a.release_type)].push(a);
  return (
    [
      { group: "album" as const, label: "Albums" },
      { group: "ep" as const, label: "EPs" },
      { group: "single" as const, label: "Singles" },
      { group: "compilation" as const, label: "Compilations" },
    ] as const
  )
    .map(({ group, label }) => ({ group, label, items: map[group] }))
    .filter(({ items }) => items.length > 0);
}

const SECONDS_PER_MINUTE = 60;
const POPULAR_TRACKS_MIN = 5;
const POPULAR_TRACKS_MAX = 10;
const ESSENTIAL_MIN_ALBUMS = 3;
const ESSENTIAL_RATIO = 0.25;
const SIMILAR_ARTISTS_MAX = 12;

function formatDuration(seconds: number | null): string {
  if (!seconds) return "–";
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = seconds % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function rankByLastfm(tracks: TopTrack[], lastfmTracks: LastfmTopTrack[]): TopTrack[] {
  const rankMap = new Map<string, number>();
  lastfmTracks.forEach(({ name }, i) => rankMap.set(normalizeTrackTitle(name), i));
  return [...tracks].sort((a, b) => {
    const ra = rankMap.get(normalizeTrackTitle(a.title)) ?? Infinity;
    const rb = rankMap.get(normalizeTrackTitle(b.title)) ?? Infinity;
    return ra - rb;
  });
}

function lastfmOnlyTracks(localTracks: TopTrack[], lastfmTracks: LastfmTopTrack[]): LastfmTopTrack[] {
  const localNorm = new Set(localTracks.map((t) => normalizeTrackTitle(t.title)));
  return lastfmTracks.filter((t) => !localNorm.has(normalizeTrackTitle(t.name))).slice(0, 10);
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(unixSecs: number): string {
  const diffDays = Math.floor((Date.now() / 1000 - unixSecs) / 86400);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return `${diffDays}d ago`;
}

const PORTRAIT_COLORS: [string, string][] = [
  ["#396cd8", "57, 108, 216"],
  ["#8b5cf6", "139, 92, 246"],
  ["#ec4899", "236, 72, 153"],
  ["#f59e0b", "245, 158, 11"],
  ["#10b981", "16, 185, 129"],
  ["#ef4444", "239, 68, 68"],
  ["#06b6d4", "6, 182, 212"],
];

function artistColor(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h * 31) + name.charCodeAt(i)) >>> 0;
  return PORTRAIT_COLORS[h % PORTRAIT_COLORS.length] ?? PORTRAIT_COLORS[0]!;
}

function resolvePortraitUrl(enrichment: { lastfm_image_url: string | null; wikidata_image_url: string | null } | null): string | null {
  const rawLastfmImage = enrichment?.lastfm_image_url ?? null;
  const lastfmPortraitUrl = rawLastfmImage && !rawLastfmImage.includes(LASTFM_PLACEHOLDER)
    ? rawLastfmImage
    : null;
  return enrichment?.wikidata_image_url ?? lastfmPortraitUrl;
}

interface TrackRowProps {
  track: TopTrack;
  rank: number;
  currentTrack: CurrentTrack | null;
  isPlaying: boolean;
  server: Server;
  credential: NavidromeCredential;
  onPlay: (track: TopTrack) => void;
  lastfmPlaycount?: number;
  onAlbumClick?: (albumId: string) => void;
  onContextMenu?: (e: React.MouseEvent, track: TopTrack) => void;
}

function TrackRow({ track, rank, currentTrack, isPlaying, server, credential, onPlay, lastfmPlaycount, onAlbumClick, onContextMenu }: TrackRowProps) {
  const isCurrentlyPlaying = currentTrack?.id === track.id && isPlaying;
  const isActive = currentTrack?.id === track.id;
  const artUrl = track.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, track.artwork_url, 64)
    : null;

  const showPlaycount = lastfmPlaycount !== undefined && lastfmPlaycount > 0;
  const showLibraryCount = !showPlaycount && track.play_count != null && track.play_count > 0;

  return (
    <div
      className={`artist-track-row${isActive ? " artist-track-row--active" : ""}`}
      onClick={() => onPlay(track)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e, track); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onPlay(track)}
    >
      <span className="artist-track-num">
        {isCurrentlyPlaying ? (
          <Play size={11} className="artist-track-playing-indicator" />
        ) : rank >= 0 ? (
          rank + 1
        ) : (
          <span className="artist-track-heart">♥</span>
        )}
      </span>
      {artUrl ? (
        <img className="artist-track-art" src={artUrl} alt="" loading="lazy" />
      ) : (
        <div className="artist-track-art artist-track-art--placeholder" />
      )}
      <div className="artist-track-info">
        <span className="artist-track-title">{track.title}</span>
        {track.album_name && track.album_id && onAlbumClick ? (
          <button
            className="artist-track-album-link"
            onClick={(e) => { e.stopPropagation(); onAlbumClick(track.album_id!); }}
          >
            {track.album_name}
          </button>
        ) : track.album_name ? (
          <span className="artist-track-album">{track.album_name}</span>
        ) : null}
      </div>
      {showPlaycount ? (
        <span className="artist-track-playcount">{formatCount(lastfmPlaycount!)} plays</span>
      ) : showLibraryCount ? (
        <span className="artist-track-playcount">{track.play_count}×</span>
      ) : (
        <span className="artist-track-duration">{formatDuration(track.duration)}</span>
      )}
    </div>
  );
}

interface SimilarArtistCardProps {
  name: string;
  owned: boolean;
  onSelect: () => void;
}

function SimilarArtistCard({ name, owned, onSelect }: SimilarArtistCardProps) {
  const { data: enrichment } = useEnrichArtist(name);
  const portraitUrl = resolvePortraitUrl(enrichment);
  const [simColor] = artistColor(name);

  return (
    <button
      className={`artist-similar-card${owned ? " artist-similar-card--owned" : " artist-similar-card--dim"}`}
      onClick={onSelect}
    >
      {portraitUrl ? (
        <img className="artist-similar-avatar" src={portraitUrl} alt="" loading="lazy" />
      ) : (
        <span className="artist-similar-avatar" style={{ backgroundColor: simColor }}>
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="artist-similar-name">{name}</span>
      <span className="artist-similar-tag">{owned ? "in library" : "search →"}</span>
    </button>
  );
}

export function ArtistDetail({ artist, serverWithCredential, onClose, onSelectAlbum, onSelectArtist }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: albums } = useArtistAlbums(artist.name);
  const { data: appearsOnAlbums } = useAppearsOnAlbums(artist.name);
  const { data: canonGenres = [] } = useArtistGenres(artist.name);
  const { data: rawTracks } = useArtistTopTracks(artist.name);
  const { data: enrichment, isRefreshing, error: enrichError, refresh } = useEnrichArtist(artist.name);
  const [showIdentify, setShowIdentify] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [popularExpanded, setPopularExpanded] = useState(false);
  const [lastfmOnlyExpanded, setLastfmOnlyExpanded] = useState(false);
  const [overflowMenuAnchor, setOverflowMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [activeReleaseGroup, setActiveReleaseGroup] = useState<ReleaseGroup | null>(null);

  const [bandsintownEnabled, setBandsintownEnabled] = useBoolSetting("enrichment.bandsintown_enabled", false);
  const [tourEvents, setTourEvents] = useState<BandsintownEvent[]>([]);
  const [tourLoading, setTourLoading] = useState(false);
  useEffect(() => {
    if (!bandsintownEnabled) {
      setTourEvents([]);
      setTourLoading(false);
      return;
    }
    let cancelled = false;
    setTourLoading(true);
    fetchBandsintownEvents(artist.name).then((events) => {
      if (!cancelled) {
        setTourEvents(events);
        setTourLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setTourLoading(false);
    });
    return () => { cancelled = true; };
  }, [bandsintownEnabled, artist.name]);

  const { data: canonicalOf, isPending: canonicalOfPending } = useArtistCanonicalOf(artist.name);
  const { data: aliases = [] } = useAliasesOfCanonical(artist.name);
  const removeAlias = useRemoveArtistAlias();

  const lastfmName = enrichment?.lastfm_artist_name ?? artist.name;
  const { data: lastfmTitles } = useLastfmTopTracks(lastfmName);
  const { data: lastfmAlbums, isLoading: lastfmAlbumsLoading } = useLastfmTopAlbums(lastfmName);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const playNext = usePlayerStore((s) => s.playNext);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const { lovedTrackIds } = useLoved();

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: TopTrack } | null>(null);

  const topTracks = rawTracks && lastfmTitles
    ? rankByLastfm(rawTracks, lastfmTitles)
    : rawTracks ?? [];
  const lovedTracks = topTracks.filter((t) => lovedTrackIds.has(t.id));
  const lfmOnlyTracks = rawTracks && lastfmTitles
    ? lastfmOnlyTracks(rawTracks, lastfmTitles)
    : [];

  const lastfmPlaycountMap = useMemo(() => {
    const m = new Map<string, number>();
    (lastfmTitles ?? []).forEach((t) => m.set(normalizeTrackTitle(t.name), t.playcount));
    return m;
  }, [lastfmTitles]);

  const popularTracks = topTracks.slice(0, popularExpanded ? POPULAR_TRACKS_MAX : POPULAR_TRACKS_MIN);

  const albumGroups = useMemo(() => (albums ? groupAlbums(albums) : []), [albums]);
  const ownedAlbumsOnly = albumGroups.find((g) => g.group === "album")?.items ?? [];

  const essentialAlbums = useMemo(() => {
    if (ownedAlbumsOnly.length <= ESSENTIAL_MIN_ALBUMS) return [];
    if (lastfmAlbumsLoading) return [];
    const cap = Math.ceil(ownedAlbumsOnly.length * ESSENTIAL_RATIO);
    if (lastfmAlbums && lastfmAlbums.length > 0) {
      const localByNorm = new Map(ownedAlbumsOnly.map((a) => [normalizeTrackTitle(a.name), a]));
      const matched: AlbumRow[] = [];
      for (const lfmAlbum of lastfmAlbums) {
        const local = localByNorm.get(normalizeTrackTitle(lfmAlbum.name));
        if (local && !matched.includes(local)) matched.push(local);
        if (matched.length >= cap) break;
      }
      if (matched.length < cap) {
        for (const album of ownedAlbumsOnly) {
          if (matched.length >= cap) break;
          if (!matched.includes(album)) matched.push(album);
        }
      }
      if (matched.length > 0) return matched;
    }
    return ownedAlbumsOnly.slice(0, cap);
  }, [ownedAlbumsOnly, lastfmAlbums, lastfmAlbumsLoading]);

  const portraitUrl = resolvePortraitUrl(enrichment);

  const localBannerUrl = artist.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, artist.artwork_url, 600)
    : null;
  const blurUrl = localBannerUrl ?? portraitUrl;

  const similar: string[] = enrichment?.similar_json
    ? (JSON.parse(enrichment.similar_json) as string[]).slice(0, SIMILAR_ARTISTS_MAX)
    : [];
  const { data: inLibrarySet } = useSimilarInLibrary(similar);
  const bio = enrichment?.bio ?? null;

  const metaItems: string[] = [
    enrichment?.listeners != null ? `${formatCount(enrichment.listeners)} listeners` : null,
    enrichment?.playcount != null ? `${formatCount(enrichment.playcount)} scrobbles` : null,
    `${artist.album_count} ${artist.album_count === 1 ? "album" : "albums"} in library`,
  ].filter((x): x is string => x !== null);

  const [color, colorRgb] = artistColor(artist.name);

  function buildTrackObj(track: TopTrack): CurrentTrack {
    const artworkRef = track.artwork_url ?? null;
    const coverArtUrl = artworkRef
      ? getCoverArtUrl(server.url, server.username, credential, artworkRef, 500)
      : null;
    return {
      id: track.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      coverArtUrl,
      artworkRef,
      album: track.album_name ?? null,
      albumId: track.album_id ?? null,
    };
  }

  const streamUrlFor = makeStreamUrlBuilder(server, credential);

  function handleAlbumClick(albumId: string) {
    const album = albums?.find((a) => a.id === albumId) ?? appearsOnAlbums?.find((a) => a.id === albumId);
    if (album) onSelectAlbum(album);
  }

  function handlePlayTrack(track: TopTrack) {
    if (!topTracks.length) return;
    const startIndex = topTracks.findIndex((t) => t.id === track.id);
    playQueue(topTracks.map(buildTrackObj), streamUrlFor, startIndex >= 0 ? startIndex : 0);
  }

  function handlePlayAll() {
    if (!topTracks.length) return;
    playQueue(topTracks.map(buildTrackObj), streamUrlFor, 0);
  }

  function handleShuffleAll() {
    if (!topTracks.length) return;
    const shuffled = shuffleArray(topTracks);
    playQueue(shuffled.map(buildTrackObj), streamUrlFor, 0);
  }

  function handleStartRadio() {
    const seed = topTracks[0];
    if (!seed) return;
    const track = buildTrackObj(seed);
    void playQueue([track], streamUrlFor, 0);
    startRadio(track);
  }

  function handleTrackContextMenu(e: React.MouseEvent, track: TopTrack) {
    setContextMenu({ x: e.clientX, y: e.clientY, track });
  }

  const defaultGroup = albumGroups[0]?.group ?? null;
  const currentGroup = activeReleaseGroup && albumGroups.some((g) => g.group === activeReleaseGroup)
    ? activeReleaseGroup
    : defaultGroup;
  const currentGroupItems = albumGroups.find((g) => g.group === currentGroup)?.items ?? [];

  return (
    <div className="artist-detail">
      {/* ── Hero ── */}
      <div className="artist-hero" style={{ ["--artist-rgb" as string]: colorRgb }}>
        {blurUrl && (
          <div className="artist-hero-bg" style={{ backgroundImage: `url(${blurUrl})` }} />
        )}
        <div className="artist-hero-wash" />

        <div className="artist-hero-header">
          <button className="artist-back-btn" onClick={onClose}>← Artists</button>
        </div>

        <div className="artist-hero-content">
          {portraitUrl ? (
            <img
              className="artist-portrait"
              src={portraitUrl}
              alt={artist.name}
              loading="lazy"
            />
          ) : (
            <div className="artist-portrait artist-portrait--fallback" style={{ backgroundColor: color }}>
              {artist.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="artist-hero-info">
            <h1 className="artist-hero-name">
              {artist.name}
            </h1>
            <div className="artist-hero-meta-row">
              {metaItems.map((item, i) => (
                <span key={i}>{i > 0 ? `· ${item}` : item}</span>
              ))}
              {canonicalOf && (
                <span className="artist-alias-badge">alias of {canonicalOf}</span>
              )}
              {aliases.length > 0 && (
                <span className="artist-alias-badge">
                  {aliases.length} {aliases.length === 1 ? "alias" : "aliases"}
                </span>
              )}
            </div>

            {canonGenres.length > 0 && (
              <div className="artist-genre-chips">
                {canonGenres.map((tag) => (
                  <span key={tag} className="artist-genre-chip">{tag}</span>
                ))}
              </div>
            )}

            {aliases.length > 0 && (
              <div className="artist-aliases-row">
                {aliases.map((a) => (
                  <span key={a} className="artist-alias-chip">
                    {a}
                    <button
                      className="artist-alias-remove"
                      onClick={() => void removeAlias.mutateAsync(a)}
                      title={`Remove alias: ${a}`}
                      aria-label={`Remove alias ${a}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="artist-hero-actions">
              {topTracks.length > 0 && (
                <button className="artist-play-btn" onClick={handlePlayAll}>
                  <Play size={13} fill="currentColor" />
                  Play
                </button>
              )}
              {topTracks.length > 1 && (
                <button className="artist-icon-btn" onClick={handleShuffleAll} title="Shuffle" aria-label="Shuffle">
                  <Shuffle size={13} />
                </button>
              )}
              {topTracks.length > 0 && (
                <button className="artist-icon-btn" onClick={handleStartRadio} title="Start Radio" aria-label="Start Radio">
                  <Radio size={13} />
                </button>
              )}
              <button
                className="artist-icon-btn"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setOverflowMenuAnchor({ x: rect.left, y: rect.bottom + 4 });
                }}
                title="More"
                aria-label="More options"
              >
                <MoreHorizontal size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="artist-body">
        {topTracks.length > 0 && (
          <section className="artist-section">
            <div className={`artist-popfav-grid${lovedTracks.length > 0 ? "" : " artist-popfav-grid--solo"}`}>
              <div className="artist-popfav-col">
                <h2 className="artist-section-title">Popular</h2>
                <div className="artist-top-tracks">
                  {popularTracks.map((track, i) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      rank={i}
                      currentTrack={currentTrack}
                      isPlaying={isPlaying}
                      server={server}
                      credential={credential}
                      onPlay={handlePlayTrack}
                      lastfmPlaycount={lastfmPlaycountMap.get(normalizeTrackTitle(track.title))}
                      onAlbumClick={handleAlbumClick}
                      onContextMenu={handleTrackContextMenu}
                    />
                  ))}
                </div>
                {topTracks.length > POPULAR_TRACKS_MIN && (
                  <button className="artist-show-more-btn" onClick={() => setPopularExpanded((v) => !v)}>
                    {popularExpanded ? "Show less" : `Show ${Math.min(POPULAR_TRACKS_MAX, topTracks.length) - POPULAR_TRACKS_MIN} more`}
                    <ChevronDown size={13} className={popularExpanded ? "artist-chevron--up" : ""} />
                  </button>
                )}
              </div>

              {lovedTracks.length > 0 && (
                <div className="artist-popfav-col">
                  <h2 className="artist-section-title">Favorites</h2>
                  <div className="artist-top-tracks">
                    {lovedTracks.map((track) => (
                      <TrackRow
                        key={track.id}
                        track={track}
                        rank={-1}
                        currentTrack={currentTrack}
                        isPlaying={isPlaying}
                        server={server}
                        credential={credential}
                        onPlay={handlePlayTrack}
                        lastfmPlaycount={lastfmPlaycountMap.get(normalizeTrackTitle(track.title))}
                        onAlbumClick={handleAlbumClick}
                        onContextMenu={handleTrackContextMenu}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {lfmOnlyTracks.length > 0 && (
              <div className="artist-lastfm-only">
                <button className="artist-lastfm-divider" onClick={() => setLastfmOnlyExpanded((v) => !v)}>
                  More on Last.fm — not in your library
                  <ChevronDown size={12} className={lastfmOnlyExpanded ? "artist-chevron--up" : ""} />
                </button>
                {lastfmOnlyExpanded && (
                  <div className="artist-lastfm-only-list">
                    {lfmOnlyTracks.map((t) => (
                      <div key={t.name} className="artist-lastfm-only-row">
                        <span className="artist-lastfm-only-title">{t.name}</span>
                        {t.playcount > 0 && (
                          <span className="artist-lastfm-only-plays">{formatCount(t.playcount)} plays</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {essentialAlbums.length > 0 && (
          <section className="artist-section">
            <h2 className="artist-section-title">Essential</h2>
            <AlbumGrid
              albums={essentialAlbums}
              serverWithCredential={serverWithCredential}
              onSelect={onSelectAlbum}
            />
          </section>
        )}

        {albumGroups.length > 0 && (
          <section className="artist-section">
            <h2 className="artist-section-title">Discography</h2>
            <div className="artist-tabs">
              {albumGroups.map(({ group, label, items }) => (
                <button
                  key={group}
                  className={`artist-tab-btn${group === currentGroup ? " artist-tab-btn--active" : ""}`}
                  onClick={() => setActiveReleaseGroup(group)}
                >
                  {label} ({items.length})
                </button>
              ))}
            </div>
            <AlbumGrid
              albums={currentGroupItems}
              serverWithCredential={serverWithCredential}
              onSelect={onSelectAlbum}
            />
          </section>
        )}

        {appearsOnAlbums && appearsOnAlbums.length > 0 && (
          <section className="artist-section">
            <h2 className="artist-section-title">Appears On</h2>
            <AlbumGrid
              albums={appearsOnAlbums}
              serverWithCredential={serverWithCredential}
              onSelect={onSelectAlbum}
            />
          </section>
        )}

        {similar.length > 0 && (
          <section className="artist-section">
            <h2 className="artist-section-title">Fans also like</h2>
            <div className="artist-similar-strip">
              {similar.map((name) => {
                const owned = inLibrarySet?.has(name) ?? false;
                return (
                  <SimilarArtistCard
                    key={name}
                    name={name}
                    owned={owned}
                    onSelect={() => onSelectArtist?.(name)}
                  />
                );
              })}
            </div>
          </section>
        )}

        {bio && (
          <section className="artist-section">
            <h2 className="artist-section-title">About</h2>
            <div className="artist-about-split">
              <div className="artist-about-card">
                <div className={`artist-bio-wrap${bioExpanded ? " artist-bio-wrap--expanded" : ""}`}>
                  <p className="artist-bio">{bio}</p>
                </div>
                {bio.length > 260 && (
                  <button className="artist-bio-toggle" onClick={() => setBioExpanded((v) => !v)}>
                    {bioExpanded ? "Show less" : "Show more"}
                  </button>
                )}
                <div className="artist-about-links">
                  {enrichment?.mb_artist_id && (
                    <button onClick={() => void openUrl(`https://musicbrainz.org/artist/${enrichment.mb_artist_id}`)}>
                      MusicBrainz ↗
                    </button>
                  )}
                  <button onClick={() => void openUrl(`https://www.last.fm/music/${encodeURIComponent(lastfmName)}`)}>
                    Last.fm ↗
                  </button>
                </div>
              </div>
              <TourCard
                artistName={artist.name}
                enabled={bandsintownEnabled}
                loading={tourLoading}
                events={tourEvents}
                onEnable={() => void setBandsintownEnabled(true)}
              />
            </div>
          </section>
        )}

        <div className="artist-enrichment-footer">
          {enrichment?.enriched_at ? (
            <span>Last.fm updated {timeAgo(enrichment.enriched_at)}</span>
          ) : (
            <span>Last.fm not loaded</span>
          )}
          <button
            className="artist-enrichment-refresh"
            onClick={() => { void refresh(); }}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
          {enrichError && <span className="artist-enrichment-error">{enrichError}</span>}
        </div>
      </div>

      {overflowMenuAnchor && (
        <ContextMenu
          x={overflowMenuAnchor.x}
          y={overflowMenuAnchor.y}
          onClose={() => setOverflowMenuAnchor(null)}
        >
          <button
            onClick={() => { setShowIdentify(true); setOverflowMenuAnchor(null); }}
          >
            <Disc size={13} /> {portraitUrl ? "Identify artist" : "Identify to add artwork"}
          </button>
          {!canonicalOfPending && !canonicalOf && (
            <button
              onClick={() => { setShowMerge(true); setOverflowMenuAnchor(null); }}
            >
              <GitMerge size={13} /> Merge into another artist
            </button>
          )}
          {enrichment?.confirmed_at && enrichment.mb_artist_id && (
            <button
              onClick={() => {
                void openUrl(`https://musicbrainz.org/artist/${enrichment.mb_artist_id}`);
                setOverflowMenuAnchor(null);
              }}
            >
              <ExternalLink size={13} /> Open on MusicBrainz
            </button>
          )}
        </ContextMenu>
      )}

      {showIdentify && (
        <ArtistIdentifyDialog
          artistName={artist.name}
          onClose={() => setShowIdentify(false)}
        />
      )}

      {showMerge && (
        <ArtistMergeModal
          aliasArtistName={artist.name}
          onClose={() => setShowMerge(false)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
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
        </ContextMenu>
      )}
    </div>
  );
}
