import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ArtistRow } from "../hooks/useArtists";
import type { ServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl } from "../lib/navidrome";
import { ContextMenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import type { RadioMode } from "../store/player";

const PADDING = 20;
const COL_GAP = 16;
const ROW_GAP = 24;
const CARD_MIN = 190;

const scrollMemory = new Map<string, number>();

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

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.offsetWidth);
    const obs = new ResizeObserver(([entry]) => {
      setContainerWidth(entry!.contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const scrollKeyRef = useRef(scrollKey);
  scrollKeyRef.current = scrollKey;
  useEffect(() => {
    const el = containerRef.current;
    if (!scrollKeyRef.current || !el) return;
    const saved = scrollMemory.get(scrollKeyRef.current);
    if (saved != null) el.scrollTop = saved;
    return () => {
      if (scrollKeyRef.current && el) scrollMemory.set(scrollKeyRef.current, el.scrollTop);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const available = containerWidth > 0 ? containerWidth - PADDING * 2 : 0;
  const cols = Math.max(1, Math.floor((available + COL_GAP) / (CARD_MIN + COL_GAP)));
  const cardWidth = available > 0 ? (available - COL_GAP * (cols - 1)) / cols : CARD_MIN;
  const rowHeight = Math.round(cardWidth) + ROW_GAP;
  const rowCount = Math.ceil(artists.length / cols);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  const prevCols = useRef(cols);
  useLayoutEffect(() => {
    if (prevCols.current !== cols) {
      prevCols.current = cols;
      virtualizer.measure();
    }
  }, [cols, virtualizer]);

  if (artists.length === 0) {
    return <p className="empty-state">No artists found. Sync first.</p>;
  }

  return (
    <>
      <div ref={containerRef} className="album-grid-scroller">
        <div style={{ height: `${virtualizer.getTotalSize() + PADDING * 2}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowStart = virtualRow.index * cols;
            const rowArtists = artists.slice(rowStart, rowStart + cols);
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: `${PADDING + virtualRow.start}px`,
                  left: `${PADDING}px`,
                  right: `${PADDING}px`,
                  height: `${Math.round(cardWidth)}px`,
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  gap: `${COL_GAP}px`,
                }}
              >
                {rowArtists.map((artist) => {
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
            );
          })}
        </div>
      </div>
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
        </ContextMenu>
      )}
    </>
  );
}
