import { useState } from "react";
import type { ArtistRow } from "../hooks/useArtists";
import type { ServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl } from "../lib/navidrome";
import { ContextMenu } from "./ContextMenu";

interface Props {
  artists: ArtistRow[];
  serverWithCredential: ServerWithCredential;
  onSelect: (artist: ArtistRow) => void;
  onStartRadio?: (artist: ArtistRow) => void;
}

export function ArtistGrid({ artists, serverWithCredential, onSelect, onStartRadio }: Props) {
  const { server, credential } = serverWithCredential;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; artist: ArtistRow } | null>(null);

  if (artists.length === 0) {
    return <p className="empty-state">No artists found. Sync first.</p>;
  }

  return (
    <>
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
            onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, artist }); }}
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
    {contextMenu && (
      <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
        <button onClick={() => { onSelect(contextMenu.artist); setContextMenu(null); }}>
          Open artist
        </button>
        {onStartRadio && (
          <button onClick={() => { onStartRadio(contextMenu.artist); setContextMenu(null); }}>
            Start radio from this
          </button>
        )}
      </ContextMenu>
    )}
    </>
  );
}
