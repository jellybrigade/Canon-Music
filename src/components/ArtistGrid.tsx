import type { ArtistRow } from "../hooks/useArtists";
import type { ServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl } from "../lib/navidrome";

interface Props {
  artists: ArtistRow[];
  serverWithCredential: ServerWithCredential;
  onSelect: (artist: ArtistRow) => void;
}

export function ArtistGrid({ artists, serverWithCredential, onSelect }: Props) {
  const { server, credential } = serverWithCredential;

  if (artists.length === 0) {
    return <p className="empty-state">No artists found. Sync first.</p>;
  }

  return (
    <div className="album-grid">
      {artists.map((artist) => {
        const imgUrl = artist.artwork_url
          ? getCoverArtUrl(server.url, server.username, credential, artist.artwork_url, 300)
          : null;
        return (
          <div
            key={artist.name}
            className="album-card"
            onClick={() => onSelect(artist)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onSelect(artist)}
          >
            {imgUrl ? (
              <img
                className="album-art"
                src={imgUrl}
                alt={artist.name}
                loading="lazy"
              />
            ) : (
              <div className="album-art album-art--placeholder" />
            )}
            <div className="album-overlay">
              <span className="album-name">{artist.name}</span>
              <span className="album-artist">
                {artist.album_count} {artist.album_count === 1 ? "album" : "albums"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
