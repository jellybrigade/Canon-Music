import { useState } from "react";
import type { ArtistRow } from "../types/library";
import { useGridPagination } from "../hooks/useGridPagination";
import type { ServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl, getArtistImageUrl } from "../lib/navidrome";
import { resolvePortraitUrl } from "../lib/lastfm";
import { useArtistImageMap } from "../hooks/useArtistImageCache";
import { ContextMenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import { Pagination } from "./TagsViewHelpers";
import { ArtistIdentifyDialog } from "./IdentifyDialog";
import type { RadioMode } from "../store/player";
import { useScrollMemory } from "../hooks/useScrollMemory";

const PADDING = 20;
const COL_GAP = 16;
const ROW_GAP = 24;
const CARD_MIN = 190;

interface Props {
  artists: ArtistRow[];
  serverWithCredential: ServerWithCredential;
  onSelect: (artist: ArtistRow) => void;
  onStartRadio?: (artist: ArtistRow, mode: RadioMode) => void;
  scrollKey?: string;
}

export function ArtistGrid({ artists, serverWithCredential, onSelect, onStartRadio, scrollKey }: Props) {
  const { server, credential } = serverWithCredential;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; artist: ArtistRow } | null>(null);
  const [identifyArtist, setIdentifyArtist] = useState<ArtistRow | null>(null);
  const [failedPortraits, setFailedPortraits] = useState<Set<string>>(new Set());
  const artistImageMap = useArtistImageMap();

  const { containerRef, cols, cardWidth, page, setPage, pageSize } = useGridPagination(artists.length, {
    padding: PADDING,
    colGap: COL_GAP,
    cardMin: CARD_MIN,
  });

  useScrollMemory(scrollKey, containerRef);

  const visibleArtists = artists.slice((page - 1) * pageSize, page * pageSize);

  if (artists.length === 0) {
    return <p className="empty-state">No artists found. Sync first.</p>;
  }

  return (
    <>
      <div ref={containerRef} className="album-grid-scroller">
        <div style={{ padding: `${PADDING}px`, display: "flex", flexDirection: "column", gap: `${ROW_GAP}px` }}>
          {Array.from({ length: Math.ceil(visibleArtists.length / cols) }, (_, i) => {
            const rowArtists = visibleArtists.slice(i * cols, i * cols + cols);
            return (
              <div
                key={i}
                style={{
                  height: `${Math.round(cardWidth)}px`,
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  gap: `${COL_GAP}px`,
                }}
              >
                {rowArtists.map((artist) => {
                  const portraitUrl = resolvePortraitUrl(artist);
                  const cachedImageUrl = artistImageMap.get(artist.name) ?? null;
                  const fallbackUrl = artist.artwork_url
                    ? getCoverArtUrl(server.url, server.username, credential, artist.artwork_url, 300)
                    : null;
                  const imgUrl = portraitUrl && !failedPortraits.has(artist.name)
                    ? (cachedImageUrl ?? getArtistImageUrl(portraitUrl))
                    : fallbackUrl;
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
                          decoding="async"
                          loading="lazy"
                          onError={() => {
                            if (portraitUrl) {
                              setFailedPortraits((prev) => new Set(prev).add(artist.name));
                            }
                          }}
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
          })}
        </div>
      </div>
      {artists.length > pageSize && (
        <div className="album-grid-pagination">
          <Pagination page={page} total={artists.length} pageSize={pageSize} onChange={setPage} />
        </div>
      )}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <button onClick={() => { onSelect(contextMenu.artist); setContextMenu(null); }}>
            Open artist
          </button>
          {onStartRadio && (
            <StartRadioSubmenu
              onSelect={(mode) => { onStartRadio(contextMenu.artist, mode); setContextMenu(null); }}
            />
          )}
          <button onClick={() => { setIdentifyArtist(contextMenu.artist); setContextMenu(null); }}>
            Identify on MusicBrainz…
          </button>
        </ContextMenu>
      )}
      {identifyArtist && (
        <ArtistIdentifyDialog
          artistName={identifyArtist.name}
          onClose={() => setIdentifyArtist(null)}
        />
      )}
    </>
  );
}
