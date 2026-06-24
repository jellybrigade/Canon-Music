import { useState } from "react";
import { Disc } from "lucide-react";
import { useFailedLookupAlbums } from "../hooks/useAlbumIdentity";
import { AlbumIdentifyDialog } from "./IdentifyDialog";
import { AlbumArt } from "./AlbumArt";
import { getCoverArtUrl } from "../lib/navidrome";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow } from "../types/library";
import "./UnidentifiedView.css";

interface Props {
  serverWithCredential: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
}

export function UnidentifiedView({ serverWithCredential, onSelectAlbum }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: albums = [] } = useFailedLookupAlbums();
  const [identifyAlbum, setIdentifyAlbum] = useState<AlbumRow | null>(null);

  return (
    <main className="content-main unidentified-view">
      <div className="unidentified-header">
        <h2 className="unidentified-title">Unidentified Albums</h2>
        {albums.length > 0 && (
          <span className="unidentified-count">{albums.length}</span>
        )}
      </div>

      {albums.length === 0 ? (
        <p className="unidentified-empty">All albums have been identified.</p>
      ) : (
        <div className="unidentified-list">
          {albums.map((album) => {
            const artUrl = album.artwork_url ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url) : null;
            return (
              <div key={album.id} className="unidentified-row">
                <div
                  className="unidentified-art-wrap"
                  onClick={() => onSelectAlbum(album)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSelectAlbum(album)}
                >
                  <AlbumArt
                    src={artUrl}
                    artist={album.artist}
                    album={album.name}
                    alt={album.name}
                    className="unidentified-art"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div
                  className="unidentified-info"
                  onClick={() => onSelectAlbum(album)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSelectAlbum(album)}
                >
                  <span className="unidentified-name">{album.name}</span>
                  {album.artist && <span className="unidentified-artist">{album.artist}</span>}
                </div>
                <button
                  className="unidentified-identify-btn"
                  onClick={() => setIdentifyAlbum(album)}
                  title="Identify on MusicBrainz"
                >
                  <Disc size={14} />
                  Identify
                </button>
              </div>
            );
          })}
        </div>
      )}

      {identifyAlbum && (
        <AlbumIdentifyDialog
          albumId={identifyAlbum.id}
          artist={identifyAlbum.artist ?? ""}
          album={identifyAlbum.name}
          onClose={() => setIdentifyAlbum(null)}
        />
      )}
    </main>
  );
}
