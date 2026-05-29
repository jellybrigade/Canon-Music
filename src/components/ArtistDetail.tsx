import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { getDb } from "../db";
import { AlbumGrid } from "./AlbumGrid";
import type { ArtistRow } from "../hooks/useArtists";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow } from "../hooks/useAlbums";
import type { CurrentTrack } from "../store/player";
import { usePlayerStore } from "../store/player";
import { getCoverArtUrl, getStreamUrl } from "../lib/navidrome";
import { stripServerPrefix } from "../lib/ids";
import { fetchArtistImage, fetchArtistTopTracks } from "../lib/lastfm";
import "./ArtistDetail.css";

interface Props {
  artist: ArtistRow;
  serverWithCredential: ServerWithCredential;
  onClose: () => void;
  onSelectAlbum: (album: AlbumRow) => void;
}

interface TopTrack {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  album_name: string | null;
  album_id: string | null;
  artwork_url: string | null;
}

function useArtistAlbums(artistName: string) {
  return useQuery({
    queryKey: ["artist-albums", artistName],
    queryFn: async (): Promise<AlbumRow[]> => {
      const db = await getDb();
      return db.select<AlbumRow[]>(
        `SELECT id, server_id, name, artist, year, artwork_url
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
                t.album_id, a.artwork_url
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

function useLastfmTopTracks(artistName: string) {
  return useQuery({
    queryKey: ["lastfm-artist-top-tracks", artistName],
    queryFn: () => fetchArtistTopTracks(artistName),
    staleTime: 7 * 24 * 60 * 60 * 1000,
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

function rankByLastfm(tracks: TopTrack[], lastfmTitles: string[]): TopTrack[] {
  const rankMap = new Map<string, number>();
  lastfmTitles.forEach((title, i) => rankMap.set(normalizeTitle(title), i));
  return [...tracks].sort((a, b) => {
    const ra = rankMap.get(normalizeTitle(a.title)) ?? Infinity;
    const rb = rankMap.get(normalizeTitle(b.title)) ?? Infinity;
    return ra - rb;
  });
}

export function ArtistDetail({ artist, serverWithCredential, onClose, onSelectAlbum }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: albums } = useArtistAlbums(artist.name);
  const { data: rawTracks } = useArtistTopTracks(artist.name);
  const { data: lastfmTitles } = useLastfmTopTracks(artist.name);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const topTracks = rawTracks && lastfmTitles
    ? rankByLastfm(rawTracks, lastfmTitles)
    : rawTracks ?? [];

  const localBannerUrl = artist.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, artist.artwork_url, 600)
    : null;

  const { data: lastfmImageUrl } = useQuery({
    queryKey: ["artist-image", artist.name],
    queryFn: () => fetchArtistImage(artist.name),
    staleTime: 7 * 24 * 60 * 60 * 1000,
    enabled: !localBannerUrl,
  });

  const bannerUrl = localBannerUrl ?? lastfmImageUrl ?? null;

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

  function streamUrlFor(track: CurrentTrack): string {
    const navTrackId = stripServerPrefix(track.id, server.id);
    return getStreamUrl(server.url, server.username, credential, navTrackId);
  }

  function handlePlayTrack(track: TopTrack) {
    if (!topTracks.length) return;
    const startIndex = topTracks.findIndex((t) => t.id === track.id);
    playQueue(topTracks.map(buildTrackObj), streamUrlFor, startIndex >= 0 ? startIndex : 0);
  }

  return (
    <div className="artist-detail">
      <div className="artist-banner">
        {bannerUrl && (
          <div
            className="artist-banner-bg"
            style={{ backgroundImage: `url(${bannerUrl})` }}
          />
        )}
        <div className="artist-banner-content">
          <button className="album-detail-back" onClick={onClose}>
            ← Artists
          </button>
          <h1 className="artist-banner-name">{artist.name}</h1>
          <span className="artist-banner-meta">
            {artist.album_count} {artist.album_count === 1 ? "album" : "albums"}
          </span>
        </div>
      </div>

      <div className="artist-detail-body">
        {topTracks.length > 0 && (
          <section className="artist-section">
            <h2 className="artist-section-title">Tracks</h2>
            <div className="artist-top-tracks">
              {topTracks.map((track, i) => {
                const isCurrentlyPlaying = currentTrack?.id === track.id && isPlaying;
                const isCurrentTrack = currentTrack?.id === track.id;
                return (
                  <div
                    key={track.id}
                    className={`artist-track-row artist-track-row--playable${isCurrentTrack ? " artist-track-row--active" : ""}`}
                    onClick={() => handlePlayTrack(track)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && handlePlayTrack(track)}
                  >
                    <span className="artist-track-num">
                      {isCurrentlyPlaying ? (
                        <span className="artist-track-playing-indicator">
                          <Play size={12} />
                        </span>
                      ) : (
                        i + 1
                      )}
                    </span>
                    <div className="artist-track-info">
                      <span className="artist-track-title">{track.title}</span>
                      {track.album_name && (
                        <span className="artist-track-album">{track.album_name}</span>
                      )}
                    </div>
                    <span className="artist-track-duration">{formatDuration(track.duration)}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {albums && albums.length > 0 && (
          <section className="artist-section">
            <h2 className="artist-section-title">Albums</h2>
            <AlbumGrid
              albums={albums}
              serverWithCredential={serverWithCredential}
              onSelect={onSelectAlbum}
            />
          </section>
        )}
      </div>
    </div>
  );
}
