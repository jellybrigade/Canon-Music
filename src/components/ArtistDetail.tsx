import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Disc, Radio } from "lucide-react";
import { getDb } from "../db";
import { AlbumGrid } from "./AlbumGrid";
import { ArtistIdentifyDialog } from "./IdentifyDialog";
import type { ArtistRow } from "../hooks/useArtists";
import type { ServerWithCredential } from "../hooks/useServer";
import type { Server } from "../types/server";
import type { NavidromeCredential } from "../lib/navidrome";
import type { AlbumRow } from "../hooks/useAlbums";
import type { CurrentTrack } from "../store/player";
import { usePlayerStore } from "../store/player";
import { getCoverArtUrl } from "../lib/navidrome";
import { makeStreamUrlBuilder } from "../lib/track";
import { fetchArtistTopTracks, fetchArtistTopAlbums, LASTFM_PLACEHOLDER } from "../lib/lastfm";
import type { LastfmTopTrack, LastfmTopAlbum } from "../lib/lastfm";
import { useEnrichArtist } from "../hooks/useEnrichArtist";
import { useLoved } from "../hooks/useLoved";
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

function useArtistAlbums(artistName: string) {
  return useQuery({
    queryKey: ["artist-albums", artistName],
    queryFn: async (): Promise<AlbumRow[]> => {
      const db = await getDb();
      return db.select<AlbumRow[]>(
        `SELECT id, server_id, name, artist, year, artwork_url, release_type
         FROM albums
         WHERE artist = ?
         ORDER BY year IS NULL, year DESC, name`,
        [artistName]
      );
    },
  });
}

function useArtistTopTracks(artistName: string) {
  return useQuery({
    queryKey: ["artist-top-tracks", artistName],
    queryFn: async (): Promise<TopTrack[]> => {
      const db = await getDb();
      return db.select<TopTrack[]>(
        `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                t.album_id, a.artwork_url, t.play_count
         FROM tracks t
         LEFT JOIN albums a ON t.album_id = a.id
         WHERE t.artist = ?
         ORDER BY t.track_number, t.title
         LIMIT 30`,
        [artistName]
      );
    },
  });
}

function useLastfmTopAlbums(artistName: string) {
  return useQuery({
    queryKey: ["lastfm-artist-top-albums", artistName],
    queryFn: (): Promise<LastfmTopAlbum[]> => fetchArtistTopAlbums(artistName),
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });
}

function useLastfmTopTracks(artistName: string) {
  return useQuery({
    queryKey: ["lastfm-artist-top-tracks", artistName],
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

function useSimilarInLibrary(names: string[]) {
  return useQuery({
    queryKey: ["similar-in-library", names],
    queryFn: async () => {
      if (names.length === 0) return new Set<string>();
      const db = await getDb();
      const placeholders = names.map(() => "?").join(",");
      const rows = await db.select<{ name: string }[]>(
        `SELECT name FROM artists WHERE name IN (${placeholders})`,
        names
      );
      return new Set(rows.map((r) => r.name));
    },
    enabled: names.length > 0,
    staleTime: Infinity,
  });
}

const SECONDS_PER_MINUTE = 60;

function formatDuration(seconds: number | null): string {
  if (!seconds) return "–";
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = seconds % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rankByLastfm(tracks: TopTrack[], lastfmTracks: LastfmTopTrack[]): TopTrack[] {
  const rankMap = new Map<string, number>();
  lastfmTracks.forEach(({ name }, i) => rankMap.set(normalizeTitle(name), i));
  return [...tracks].sort((a, b) => {
    const ra = rankMap.get(normalizeTitle(a.title)) ?? Infinity;
    const rb = rankMap.get(normalizeTitle(b.title)) ?? Infinity;
    return ra - rb;
  });
}

function lastfmOnlyTracks(localTracks: TopTrack[], lastfmTracks: LastfmTopTrack[]): LastfmTopTrack[] {
  const localNorm = new Set(localTracks.map((t) => normalizeTitle(t.title)));
  return lastfmTracks.filter((t) => !localNorm.has(normalizeTitle(t.name))).slice(0, 10);
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

const PORTRAIT_COLORS = [
  "#396cd8", "#8b5cf6", "#ec4899",
  "#f59e0b", "#10b981", "#ef4444", "#06b6d4",
];

function artistColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h * 31) + name.charCodeAt(i)) >>> 0;
  return PORTRAIT_COLORS[h % PORTRAIT_COLORS.length] ?? "#396cd8";
}

interface TrackRowProps {
  track: TopTrack;
  topTracks: TopTrack[];
  currentTrack: CurrentTrack | null;
  isPlaying: boolean;
  server: Server;
  credential: NavidromeCredential;
  onPlay: (track: TopTrack) => void;
  lastfmPlaycount?: number;
  onAlbumClick?: (albumId: string) => void;
}

function TrackRow({ track, topTracks, currentTrack, isPlaying, server, credential, onPlay, lastfmPlaycount, onAlbumClick }: TrackRowProps) {
  const isCurrentlyPlaying = currentTrack?.id === track.id && isPlaying;
  const isActive = currentTrack?.id === track.id;
  const rank = topTracks.indexOf(track);
  const artUrl = track.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, track.artwork_url, 64)
    : null;

  const showPlaycount = lastfmPlaycount !== undefined && lastfmPlaycount > 0;
  const showLibraryCount = !showPlaycount && track.play_count != null && track.play_count > 0;

  return (
    <div
      className={`artist-track-row${isActive ? " artist-track-row--active" : ""}`}
      onClick={() => onPlay(track)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onPlay(track)}
    >
      <span className="artist-track-num">
        {isCurrentlyPlaying ? (
          <Play size={11} className="artist-track-playing-indicator" />
        ) : (
          rank >= 0 ? rank + 1 : "♥"
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
        <span className="artist-track-playcount">{formatCount(lastfmPlaycount!)}</span>
      ) : showLibraryCount ? (
        <span className="artist-track-playcount">{track.play_count}×</span>
      ) : (
        <span className="artist-track-duration">{formatDuration(track.duration)}</span>
      )}
    </div>
  );
}

export function ArtistDetail({ artist, serverWithCredential, onClose, onSelectAlbum, onSelectArtist }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: albums } = useArtistAlbums(artist.name);
  const { data: rawTracks } = useArtistTopTracks(artist.name);
  const { data: enrichment, isRefreshing, error: enrichError, refresh } = useEnrichArtist(artist.name);
  const [showIdentify, setShowIdentify] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);

  const lastfmName = enrichment?.lastfm_artist_name ?? artist.name;
  const { data: lastfmTitles } = useLastfmTopTracks(lastfmName);
  const { data: lastfmAlbums } = useLastfmTopAlbums(lastfmName);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const { lovedTrackIds } = useLoved();

  const topTracks = rawTracks && lastfmTitles
    ? rankByLastfm(rawTracks, lastfmTitles)
    : rawTracks ?? [];
  const lovedTracks = topTracks.filter((t) => lovedTrackIds.has(t.id));
  const lfmOnlyTracks = rawTracks && lastfmTitles
    ? lastfmOnlyTracks(rawTracks, lastfmTitles)
    : [];

  const lastfmPlaycountMap = useMemo(() => {
    const m = new Map<string, number>();
    (lastfmTitles ?? []).forEach((t) => m.set(normalizeTitle(t.name), t.playcount));
    return m;
  }, [lastfmTitles]);

  const popularAlbums = useMemo(() => {
    if (!albums || !lastfmAlbums || lastfmAlbums.length === 0) return [];
    const localByNorm = new Map(albums.map((a) => [normalizeTitle(a.name), a]));
    const matched: AlbumRow[] = [];
    for (const lfmAlbum of lastfmAlbums) {
      const local = localByNorm.get(normalizeTitle(lfmAlbum.name));
      if (local) matched.push(local);
      if (matched.length >= 6) break;
    }
    return matched;
  }, [albums, lastfmAlbums]);

  const rawLastfmImage = enrichment?.lastfm_image_url ?? null;
  const lastfmPortraitUrl = rawLastfmImage && !rawLastfmImage.includes(LASTFM_PLACEHOLDER)
    ? rawLastfmImage
    : null;
  const wikidataImage = enrichment?.wikidata_image_url ?? null;
  const portraitUrl = wikidataImage ?? lastfmPortraitUrl;

  const localBannerUrl = artist.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, artist.artwork_url, 600)
    : null;
  const blurUrl = localBannerUrl ?? portraitUrl;

  const similar: string[] = enrichment?.similar_json
    ? (JSON.parse(enrichment.similar_json) as string[])
    : [];
  const { data: inLibrarySet } = useSimilarInLibrary(similar);
  const similarInLibrary = similar.filter((n) => inLibrarySet?.has(n));
  const similarNotInLibrary = similar.filter((n) => !inLibrarySet?.has(n));
  const bio = enrichment?.bio ?? null;
  const hasSideContent = !!(bio || similar.length > 0);

  const metaItems: string[] = [
    enrichment?.listeners != null ? `${formatCount(enrichment.listeners)} listeners` : null,
    enrichment?.playcount != null ? `${formatCount(enrichment.playcount)} plays` : null,
    `${artist.album_count} ${artist.album_count === 1 ? "album" : "albums"}`,
  ].filter((x): x is string => x !== null);

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
    const album = albums?.find((a) => a.id === albumId);
    if (album) onSelectAlbum(album);
  }

  function handlePlayTrack(track: TopTrack) {
    if (!topTracks.length) return;
    const startIndex = topTracks.findIndex((t) => t.id === track.id);
    playQueue(topTracks.map(buildTrackObj), streamUrlFor, startIndex >= 0 ? startIndex : 0);
  }

  function handleStartRadio() {
    const seed = topTracks[0];
    if (!seed) return;
    startRadio(buildTrackObj(seed));
  }

  return (
    <div className="artist-detail">
      {/* ── Banner ── */}
      <div className="artist-banner">
        {blurUrl && (
          <div className="artist-banner-bg" style={{ backgroundImage: `url(${blurUrl})` }} />
        )}
        <div className="artist-banner-overlay" />

        <div className="artist-banner-header">
          <button className="artist-back-btn" onClick={onClose}>← Artists</button>
        </div>

        <div className="artist-banner-content">
          {portraitUrl ? (
            <img
              className="artist-portrait"
              src={portraitUrl}
              alt={artist.name}
              loading="lazy"
            />
          ) : (
            <div
              className="artist-portrait artist-portrait--fallback"
              style={{ backgroundColor: artistColor(artist.name) }}
            >
              {artist.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="artist-banner-info">
            <h1 className="artist-banner-name">{artist.name}</h1>
            <div className="artist-banner-meta-row">
              {metaItems.map((item, i) => (
                <span key={i}>{i > 0 ? `· ${item}` : item}</span>
              ))}
              {enrichment?.confirmed_at && (
                <span className="mb-verified-badge">
                  <Disc size={9} /> MB
                </span>
              )}
            </div>
          </div>

          <div className="artist-banner-actions">
            {topTracks.length > 0 && (
              <button className="artist-radio-btn" onClick={handleStartRadio}>
                <Radio size={13} />
                Radio
              </button>
            )}
            <button
              className="artist-identify-btn"
              onClick={() => setShowIdentify(true)}
              aria-label="Identify artist on MusicBrainz"
            >
              <Disc size={13} />
              Identify
            </button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className={`artist-detail-body${hasSideContent ? "" : " artist-detail-body--full"}`}>
        <div className="artist-body-main">
          {lovedTracks.length > 0 && (
            <section className="artist-section">
              <h2 className="artist-section-title">Favorites</h2>
              <div className="artist-top-tracks artist-top-tracks--grid">
                {lovedTracks.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    topTracks={topTracks}
                    currentTrack={currentTrack}
                    isPlaying={isPlaying}
                    server={server}
                    credential={credential}
                    onPlay={handlePlayTrack}
                    lastfmPlaycount={lastfmPlaycountMap.get(normalizeTitle(track.title))}
                    onAlbumClick={handleAlbumClick}
                  />
                ))}
              </div>
            </section>
          )}

          {popularAlbums.length > 0 && (
            <section className="artist-section">
              <h2 className="artist-section-title">Popular</h2>
              <AlbumGrid
                albums={popularAlbums}
                serverWithCredential={serverWithCredential}
                onSelect={onSelectAlbum}
              />
            </section>
          )}

          {albums && albums.length > 0 && groupAlbums(albums).map(({ label, items }) => (
            <section key={label} className="artist-section">
              <h2 className="artist-section-title">{label}</h2>
              <AlbumGrid
                albums={items}
                serverWithCredential={serverWithCredential}
                onSelect={onSelectAlbum}
              />
            </section>
          ))}

          {topTracks.length > 0 && (
            <section className="artist-section">
              <h2 className="artist-section-title">Tracks</h2>
              <div className="artist-top-tracks artist-top-tracks--grid">
                {topTracks.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    topTracks={topTracks}
                    currentTrack={currentTrack}
                    isPlaying={isPlaying}
                    server={server}
                    credential={credential}
                    onPlay={handlePlayTrack}
                    lastfmPlaycount={lastfmPlaycountMap.get(normalizeTitle(track.title))}
                    onAlbumClick={handleAlbumClick}
                  />
                ))}
              </div>
              {lfmOnlyTracks.length > 0 && (
                <div className="artist-lastfm-only">
                  <p className="artist-lastfm-only-label">Also on Last.fm</p>
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
            </section>
          )}
        </div>

        {hasSideContent && (
          <div className="artist-body-side">
            {bio && (
              <section className="artist-section">
                <h2 className="artist-section-title">About</h2>
                <div className={`artist-bio-wrap${bioExpanded ? " artist-bio-wrap--expanded" : ""}`}>
                  <p className="artist-bio">{bio}</p>
                </div>
                {bio.length > 200 && (
                  <button className="artist-bio-toggle" onClick={() => setBioExpanded((v) => !v)}>
                    {bioExpanded ? "Show less" : "Show more"}
                  </button>
                )}
              </section>
            )}

            {similar.length > 0 && (
              <section className="artist-section">
                {similarInLibrary.length > 0 && (
                  <>
                    <h2 className="artist-section-title">Similar — In Library</h2>
                    <div className="artist-similar-list">
                      {similarInLibrary.map((name) => (
                        <button key={name} className="artist-similar-card" onClick={() => onSelectArtist?.(name)}>
                          {name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {similarNotInLibrary.length > 0 && (
                  <>
                    <h2 className="artist-section-title" style={{ marginTop: similarInLibrary.length > 0 ? "1rem" : undefined }}>
                      Similar — Not in Library
                    </h2>
                    <div className="artist-similar-list">
                      {similarNotInLibrary.map((name) => (
                        <button key={name} className="artist-similar-card artist-similar-card--dim" onClick={() => onSelectArtist?.(name)}>
                          {name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
          </div>
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

      {showIdentify && (
        <ArtistIdentifyDialog
          artistName={artist.name}
          onClose={() => setShowIdentify(false)}
        />
      )}
    </div>
  );
}
