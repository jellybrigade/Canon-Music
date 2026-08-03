import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractAccent } from "../lib/artColor";
import { useQuery } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { Play, Shuffle, Radio, Disc, ExternalLink, GitMerge, MoreHorizontal, ChevronDown, Mic2 } from "lucide-react";
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
import { fetchArtistTopTracks, fetchArtistTopAlbums, fetchTrackAlbum, normalizeTrackTitle, resolvePortraitUrl } from "../lib/lastfm";
import { useArtistImageMap, resolveArtistImageUrl } from "../hooks/useArtistImageCache";
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
  lastfmRank?: number;
  lastfmPlaycount?: number;
  lastfmCombined?: boolean;
}

function useArtistTopTracks(artistName: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: QK.artistTopTracks(artistName),
    enabled: options?.enabled,
    queryFn: async (): Promise<TopTrack[]> => {
      const db = await getDb();
      return db.select<TopTrack[]>(
        `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                t.album_id, a.artwork_url, t.play_count
         FROM tracks t
         LEFT JOIN albums a ON t.album_id = a.id
         WHERE t.artist = ?
            OR t.artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?)
         ORDER BY t.track_number, t.title`,
        [artistName, artistName]
      );
    },
  });
}

/** One row, purely as a radio seed for a similar-artist card. Kept separate from
 * useArtistTopTracks because that query selects every track the artist has, and a
 * strip of similar artists is entirely on screen at once - twelve whole-table
 * scans to read twelve first rows. */
function useArtistSeedTrack(artistName: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: QK.artistSeedTrack(artistName),
    enabled: options?.enabled,
    queryFn: async (): Promise<TopTrack | null> => {
      const db = await getDb();
      const rows = await db.select<TopTrack[]>(
        `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                t.album_id, a.artwork_url, t.play_count
         FROM tracks t
         LEFT JOIN albums a ON t.album_id = a.id
         WHERE t.artist = ?
            OR t.artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?)
         ORDER BY t.play_count DESC, t.track_number, t.title
         LIMIT 1`,
        [artistName, artistName]
      );
      return rows[0] ?? null;
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

function buildTrackObj(track: TopTrack, server: Server, credential: NavidromeCredential): CurrentTrack {
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

function formatDuration(seconds: number | null): string {
  if (!seconds) return "-";
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = seconds % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Last.fm's per-title playcount can't distinguish which local copy it belongs to when
// several local tracks share a title (e.g. clipping.'s many "Intro" tracks), Last.fm's
// own chart merges those into one page. For an ambiguous title, ask Last.fm which album
// it considers representative and match that against the local copies; if nothing matches,
// fall back to whichever local copy has the most local plays. Either way the winner is
// marked `lastfmCombined` since the number is known to span more than this one track.
async function matchLastfmTracks(
  tracks: TopTrack[],
  lastfmTracks: LastfmTopTrack[],
  artistName: string
): Promise<TopTrack[]> {
  const lastfmByTitle = new Map<string, { rank: number; playcount: number }>();
  lastfmTracks.forEach((t, i) => {
    const key = normalizeTrackTitle(t.name);
    if (!lastfmByTitle.has(key)) lastfmByTitle.set(key, { rank: i, playcount: t.playcount });
  });

  const groups = new Map<string, TopTrack[]>();
  for (const t of tracks) {
    const key = normalizeTrackTitle(t.title);
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  }

  const result: TopTrack[] = tracks.map((t) => ({ ...t }));
  const byId = new Map(result.map((t) => [t.id, t]));

  // Every ambiguous group used to cost a `track.getInfo` call, and those calls are
  // serialized behind Last.fm's shared 250ms limiter, so an artist with many
  // repeated titles (live sets, compilations) spent seconds of the same budget the
  // similar-artist cards on this page enrich against, and the Popular list visibly
  // re-sorted when it finally landed. Only the groups that can reach the visible
  // list are worth a lookup; the rest fall back to the local play-count heuristic,
  // which is what a failed lookup uses anyway.
  const ambiguous = [...groups.entries()]
    .filter(([key, group]) => group.length > 1 && lastfmByTitle.has(key))
    .sort(([a], [b]) => lastfmByTitle.get(b)!.playcount - lastfmByTitle.get(a)!.playcount);
  const lookupTitles = new Set(ambiguous.slice(0, POPULAR_TRACKS_MAX).map(([key]) => key));

  for (const [key, group] of groups) {
    const lfm = lastfmByTitle.get(key);
    if (!lfm) continue;

    const [first, ...rest] = group;
    if (!first) continue;

    if (rest.length === 0) {
      const winner = byId.get(first.id)!;
      winner.lastfmRank = lfm.rank;
      winner.lastfmPlaycount = lfm.playcount;
      continue;
    }

    let winner: TopTrack | undefined;
    const repAlbum = lookupTitles.has(key) ? await fetchTrackAlbum(artistName, first.title) : null;
    if (repAlbum) {
      const repNorm = normalizeTrackTitle(repAlbum);
      winner = group.find((t) => t.album_name && normalizeTrackTitle(t.album_name) === repNorm);
    }
    winner ??= [...group].sort((a, b) => (b.play_count ?? 0) - (a.play_count ?? 0))[0];
    if (!winner) continue;

    const winnerEnriched = byId.get(winner.id)!;
    winnerEnriched.lastfmRank = lfm.rank;
    winnerEnriched.lastfmPlaycount = lfm.playcount;
    winnerEnriched.lastfmCombined = true;
  }

  return result;
}

function useMatchedTracks(
  artistName: string,
  tracks: TopTrack[] | undefined,
  lastfmTracks: LastfmTopTrack[] | undefined
) {
  return useQuery({
    queryKey: QK.lastfmTrackMatch(artistName, (tracks ?? []).map((t) => t.id)),
    queryFn: () => matchLastfmTracks(tracks ?? [], lastfmTracks ?? [], artistName),
    enabled: !!tracks && !!lastfmTracks,
    staleTime: 7 * 24 * 60 * 60 * 1000,
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

interface TrackRowProps {
  track: TopTrack;
  rank: number;
  currentTrack: CurrentTrack | null;
  isPlaying: boolean;
  server: Server;
  credential: NavidromeCredential;
  onPlay: (track: TopTrack) => void;
  lastfmPlaycount?: number;
  lastfmCombined?: boolean;
  onAlbumClick?: (albumId: string) => void;
  onContextMenu?: (e: React.MouseEvent, track: TopTrack) => void;
}

const TrackRow = memo(function TrackRow({ track, rank, currentTrack, isPlaying, server, credential, onPlay, lastfmPlaycount, lastfmCombined, onAlbumClick, onContextMenu }: TrackRowProps) {
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
        <img className="artist-track-art" src={artUrl} alt="" loading="lazy" decoding="async" />
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
        <span
          className="artist-track-playcount"
          title={lastfmCombined ? `Combined across multiple tracks named "${track.title}" by ${track.artist ?? "this artist"}` : undefined}
        >
          {formatCount(lastfmPlaycount!)} plays{lastfmCombined ? " · combined" : ""}
        </span>
      ) : showLibraryCount ? (
        <span className="artist-track-playcount">{track.play_count}×</span>
      ) : (
        <span className="artist-track-duration">{formatDuration(track.duration)}</span>
      )}
    </div>
  );
});

interface SimilarArtistCardProps {
  name: string;
  owned: boolean;
  onSelect: () => void;
  server: Server;
  credential: NavidromeCredential;
}

const SimilarArtistCard = memo(function SimilarArtistCard({ name, owned, onSelect, server, credential }: SimilarArtistCardProps) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView]);

  const { data: enrichment } = useEnrichArtist(name, { enabled: inView, serverWithCredential: { server, credential } });
  const artistImageMap = useArtistImageMap();
  const rawPortraitUrl = resolvePortraitUrl(enrichment);
  const portraitUrl = resolveArtistImageUrl(artistImageMap, name, rawPortraitUrl);

  const { data: seedTrack } = useArtistSeedTrack(name, { enabled: inView });
  const playQueue = usePlayerStore((s) => s.playQueue);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const streamUrlFor = useMemo(() => makeStreamUrlBuilder(server, credential), [server, credential]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function handleContextMenu(e: React.MouseEvent) {
    if (!owned || !seedTrack) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      <button
        ref={cardRef}
        className={`artist-similar-card${owned ? " artist-similar-card--owned" : " artist-similar-card--dim"}`}
        onClick={onSelect}
        onContextMenu={handleContextMenu}
      >
        {portraitUrl ? (
          <img className="artist-similar-avatar" src={portraitUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="artist-similar-avatar artist-similar-avatar--fallback">
            <Mic2 size={28} strokeWidth={1.5} />
          </span>
        )}
        <span className="artist-similar-name">{name}</span>
        <span className="artist-similar-tag">{owned ? "in library" : "search →"}</span>
      </button>

      {menu && seedTrack && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            onClick={() => {
              onSelect();
              setMenu(null);
            }}
          >
            Go to artist
          </button>
          <StartRadioSubmenu
            onSelect={(mode) => {
              const track = buildTrackObj(seedTrack, server, credential);
              void playQueue([track], streamUrlFor, 0);
              startRadio(track, mode);
              setMenu(null);
            }}
          />
        </ContextMenu>
      )}
    </>
  );
});

export function ArtistDetail({ artist, serverWithCredential, onClose, onSelectAlbum, onSelectArtist }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: albums } = useArtistAlbums(artist.name);
  const { data: appearsOnAlbums } = useAppearsOnAlbums(artist.name);
  const { data: canonGenres = [] } = useArtistGenres(artist.name);
  const { data: rawTracks } = useArtistTopTracks(artist.name);
  const { data: enrichment, isRefreshing, error: enrichError, refresh } = useEnrichArtist(artist.name, { serverWithCredential });
  const [showIdentify, setShowIdentify] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [popularExpanded, setPopularExpanded] = useState(false);
  const [lastfmOnlyExpanded, setLastfmOnlyExpanded] = useState(false);
  const [overflowMenuAnchor, setOverflowMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [activeReleaseGroup, setActiveReleaseGroup] = useState<ReleaseGroup | null>(null);
  const [similarTab, setSimilarTab] = useState<"in" | "out">("in");

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

  const { data: matchedTracks } = useMatchedTracks(lastfmName, rawTracks, lastfmTitles);
  const topTracks = useMemo(() => {
    const source = matchedTracks ?? rawTracks ?? [];
    const rank = (t: TopTrack) => t.lastfmPlaycount ?? -1;
    return [...source].sort((a, b) => {
      const byPlaycount = rank(b) - rank(a);
      if (byPlaycount !== 0) return byPlaycount;
      return (a.lastfmRank ?? Infinity) - (b.lastfmRank ?? Infinity);
    });
  }, [matchedTracks, rawTracks]);
  const lovedTracks = useMemo(
    () => topTracks.filter((t) => lovedTrackIds.has(t.id)),
    [topTracks, lovedTrackIds]
  );
  const lfmOnlyTracks = useMemo(
    () => (rawTracks && lastfmTitles ? lastfmOnlyTracks(rawTracks, lastfmTitles) : []),
    [rawTracks, lastfmTitles]
  );

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

  const artistImageMap = useArtistImageMap();
  const rawPortraitUrl = resolvePortraitUrl(enrichment);
  const portraitUrl = resolveArtistImageUrl(artistImageMap, artist.name, rawPortraitUrl);

  const [accentColor, setAccentColor] = useState<string | null>(null);
  useEffect(() => {
    setAccentColor(null);
    if (!portraitUrl) return;
    let cancelled = false;
    void extractAccent(portraitUrl).then((color) => {
      if (!cancelled) setAccentColor(color);
    });
    return () => { cancelled = true; };
  }, [portraitUrl]);

  // Parsed defensively: a malformed or legacy `similar_json` value would otherwise
  // throw inside render and blank the whole artist page via the error boundary.
  const similar: string[] = useMemo(() => {
    if (!enrichment?.similar_json) return [];
    try {
      const parsed: unknown = JSON.parse(enrichment.similar_json);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((n): n is string => typeof n === "string").slice(0, SIMILAR_ARTISTS_MAX);
    } catch {
      return [];
    }
  }, [enrichment?.similar_json]);
  const { data: inLibrarySet } = useSimilarInLibrary(similar);
  const similarInLibrary = useMemo(
    () => similar.filter((name) => inLibrarySet?.has(name)),
    [similar, inLibrarySet]
  );
  const similarNotInLibrary = useMemo(
    () => similar.filter((name) => !inLibrarySet?.has(name)),
    [similar, inLibrarySet]
  );
  const effectiveSimilarTab = similarInLibrary.length === 0 ? "out" : similarTab;
  const bio = enrichment?.bio ?? null;

  const metaItems: string[] = [
    enrichment?.listeners != null ? `${formatCount(enrichment.listeners)} listeners` : null,
    enrichment?.playcount != null ? `${formatCount(enrichment.playcount)} scrobbles` : null,
    `${artist.album_count} ${artist.album_count === 1 ? "album" : "albums"} in library`,
  ].filter((x): x is string => x !== null);

  const toTrackObj = useCallback(
    (track: TopTrack) => buildTrackObj(track, server, credential),
    [server, credential]
  );

  const streamUrlFor = useMemo(() => makeStreamUrlBuilder(server, credential), [server, credential]);

  const handleAlbumClick = useCallback(
    (albumId: string) => {
      const album = albums?.find((a) => a.id === albumId) ?? appearsOnAlbums?.find((a) => a.id === albumId);
      if (album) onSelectAlbum(album);
    },
    [albums, appearsOnAlbums, onSelectAlbum]
  );

  const handlePlayTrack = useCallback(
    (track: TopTrack) => {
      if (!topTracks.length) return;
      const startIndex = topTracks.findIndex((t) => t.id === track.id);
      playQueue(topTracks.map(toTrackObj), streamUrlFor, startIndex >= 0 ? startIndex : 0);
    },
    [topTracks, playQueue, streamUrlFor]
  );

  function handlePlayAll() {
    if (!topTracks.length) return;
    playQueue(topTracks.map(toTrackObj), streamUrlFor, 0);
  }

  function handleShuffleAll() {
    if (!topTracks.length) return;
    const shuffled = shuffleArray(topTracks);
    playQueue(shuffled.map(toTrackObj), streamUrlFor, 0);
  }

  function handleStartRadio() {
    const seed = topTracks[0];
    if (!seed) return;
    const track = toTrackObj(seed);
    void playQueue([track], streamUrlFor, 0);
    startRadio(track);
  }

  const handleTrackContextMenu = useCallback((e: React.MouseEvent, track: TopTrack) => {
    setContextMenu({ x: e.clientX, y: e.clientY, track });
  }, []);

  const defaultGroup = albumGroups[0]?.group ?? null;
  const currentGroup = activeReleaseGroup && albumGroups.some((g) => g.group === activeReleaseGroup)
    ? activeReleaseGroup
    : defaultGroup;
  const currentGroupItems = albumGroups.find((g) => g.group === currentGroup)?.items ?? [];

  const heroArt = portraitUrl ? (
    <img className="artist-hero-art" src={portraitUrl} alt={artist.name} loading="lazy" decoding="async" />
  ) : (
    <div className="artist-hero-art artist-hero-art--fallback">
      <Mic2 size={38} strokeWidth={1.5} />
    </div>
  );

  return (
    <div className="artist-detail">
      <div className="artist-hero">
        <button className="artist-back-btn" onClick={onClose}>← Artists</button>

        <div
          className="artist-hero-main"
          style={accentColor ? ({ "--artist-accent": accentColor } as React.CSSProperties) : undefined}
          onContextMenu={(e) => {
            e.preventDefault();
            setOverflowMenuAnchor({ x: e.clientX, y: e.clientY });
          }}
        >
          {heroArt}
          <div className="artist-hero-info">
            <h1 className="artist-hero-name">{artist.name}</h1>
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
              <p className="artist-hero-genres">{canonGenres.join(" / ")}</p>
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
                  setOverflowMenuAnchor({ x: rect.left, y: rect.bottom });
                }}
                title="More"
                aria-label="More"
              >
                <MoreHorizontal size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>

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
                      lastfmPlaycount={track.lastfmPlaycount}
                      lastfmCombined={track.lastfmCombined}
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
                        lastfmPlaycount={track.lastfmPlaycount}
                      lastfmCombined={track.lastfmCombined}
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
                  More on Last.fm (not in your library)
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
            <div className="artist-tabs">
              <button
                className={`artist-tab-btn${effectiveSimilarTab === "in" ? " artist-tab-btn--active" : ""}`}
                onClick={() => setSimilarTab("in")}
                disabled={similarInLibrary.length === 0}
              >
                In library ({similarInLibrary.length})
              </button>
              <button
                className={`artist-tab-btn${effectiveSimilarTab === "out" ? " artist-tab-btn--active" : ""}`}
                onClick={() => setSimilarTab("out")}
                disabled={similarNotInLibrary.length === 0}
              >
                Not in library ({similarNotInLibrary.length})
              </button>
            </div>
            <div className="artist-similar-strip">
              {(effectiveSimilarTab === "in" ? similarInLibrary : similarNotInLibrary).map((name) => (
                <SimilarArtistCard
                  key={name}
                  name={name}
                  owned={effectiveSimilarTab === "in"}
                  onSelect={() => onSelectArtist?.(name)}
                  server={server}
                  credential={credential}
                />
              ))}
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
              playNext(toTrackObj(contextMenu.track), streamUrlFor);
              setContextMenu(null);
            }}
          >
            Play Next
          </button>
          <button
            onClick={() => {
              addToQueue(toTrackObj(contextMenu.track), streamUrlFor);
              setContextMenu(null);
            }}
          >
            Add to Queue
          </button>
          <StartRadioSubmenu
            onSelect={(mode) => {
              const track = toTrackObj(contextMenu.track);
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
