import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { AlbumGrid } from "./AlbumGrid";
import type { ArtistRow } from "../hooks/useArtists";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow } from "../hooks/useAlbums";
import { getCoverArtUrl } from "../lib/navidrome";
import { fetchArtistImage } from "../lib/lastfm";
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
        `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name
         FROM tracks t
         LEFT JOIN albums a ON t.album_id = a.id
         WHERE t.artist = ?
         ORDER BY t.track_number, t.title
         LIMIT 10`,
        [artistName]
      );
    },
  });
}

const SECONDS_PER_MINUTE = 60;

function formatDuration(seconds: number | null): string {
  if (!seconds) return "–";
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = seconds % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ArtistDetail({ artist, serverWithCredential, onClose, onSelectAlbum }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: albums } = useArtistAlbums(artist.name);
  const { data: topTracks } = useArtistTopTracks(artist.name);

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
        {topTracks && topTracks.length > 0 && (
          <section className="artist-section">
            <h2 className="artist-section-title">Tracks</h2>
            <div className="artist-top-tracks">
              {topTracks.map((track, i) => (
                <div key={track.id} className="artist-track-row">
                  <span className="artist-track-num">{i + 1}</span>
                  <div className="artist-track-info">
                    <span className="artist-track-title">{track.title}</span>
                    {track.album_name && (
                      <span className="artist-track-album">{track.album_name}</span>
                    )}
                  </div>
                  <span className="artist-track-duration">{formatDuration(track.duration)}</span>
                </div>
              ))}
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
