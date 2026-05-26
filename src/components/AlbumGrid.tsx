import { Heart, AlertTriangle } from "lucide-react";
import type { AlbumRow } from "../hooks/useAlbums";
import type { ServerWithCredential } from "../hooks/useServer";
import { useLoved } from "../hooks/useLoved";
import { useOffTreeAlbumIds } from "../hooks/useTrackTags";
import { getCoverArtUrl } from "../lib/navidrome";

interface Props {
  albums: AlbumRow[];
  serverWithCredential: ServerWithCredential;
  onSelect: (album: AlbumRow) => void;
}

export function AlbumGrid({ albums, serverWithCredential, onSelect }: Props) {
  const { server, credential } = serverWithCredential;
  const { lovedAlbumIds, toggleAlbumLove } = useLoved();
  const { data: offTreeIds } = useOffTreeAlbumIds();
  const offTreeSet = new Set(offTreeIds ?? []);

  if (albums.length === 0) {
    return <p className="empty-state">No albums yet. Syncing…</p>;
  }

  return (
    <div className="album-grid">
      {albums.map((album) => (
        <div
          key={album.id}
          className="album-card"
          onClick={() => onSelect(album)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onSelect(album)}
        >
          {album.artwork_url ? (
            <img
              className="album-art"
              src={getCoverArtUrl(server.url, server.username, credential, album.artwork_url)}
              alt={album.name}
              loading="lazy"
            />
          ) : (
            <div className="album-art album-art--placeholder" />
          )}
          <button
            className={`album-heart${lovedAlbumIds.has(album.id) ? " album-heart--loved" : ""}`}
            aria-label={lovedAlbumIds.has(album.id) ? "Unlove album" : "Love album"}
            onClick={(e) => { e.stopPropagation(); void toggleAlbumLove(album.id, serverWithCredential); }}
          >
            <Heart
              size={14}
              fill={lovedAlbumIds.has(album.id) ? "currentColor" : "none"}
              strokeWidth={2}
            />
          </button>
          {offTreeSet.has(album.id) && (
            <div className="album-off-tree-badge" title="Has off-tree tags">
              <AlertTriangle size={11} />
            </div>
          )}
          <div className="album-overlay">
            <span className="album-name">{album.name}</span>
            {album.artist && (
              <span className="album-artist">{album.artist}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
