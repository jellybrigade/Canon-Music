import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Heart, AlertTriangle } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AlbumRow, AlbumSort } from "../hooks/useAlbums";
import type { ServerWithCredential } from "../hooks/useServer";
import { useLoved } from "../hooks/useLoved";
import { useOffTreeAlbumIds } from "../hooks/useTrackTags";
import { getCoverArtUrl } from "../lib/navidrome";
import { ContextMenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import type { RadioMode } from "../store/player";
import "./AlbumGrid.css";

const PADDING = 20;
const COL_GAP = 16;
const ROW_GAP = 24;
const CARD_MIN = 190;

const scrollMemory = new Map<string, number>();

interface Props {
  albums: AlbumRow[];
  serverWithCredential: ServerWithCredential;
  onSelect: (album: AlbumRow) => void;
  onStartRadio?: (album: AlbumRow, mode: RadioMode) => void;
  emptyMessage?: string;
  scrollKey?: string;
  sort?: AlbumSort;
}

export function AlbumGrid({ albums, serverWithCredential, onSelect, onStartRadio, emptyMessage, scrollKey, sort }: Props) {
  const { server, credential } = serverWithCredential;
  const { lovedAlbumIds, toggleAlbumLove } = useLoved();
  const { data: offTreeIds } = useOffTreeAlbumIds();
  const offTreeSet = useMemo(() => new Set(offTreeIds ?? []), [offTreeIds]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; album: AlbumRow } | null>(null);

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

  // Restore saved scroll position on mount; save it on unmount.
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

  // Re-measure when albums transition from empty to non-empty — stale containerWidth
  // from the empty state can leave cols=1 and produce full-width stacked images.
  const prevAlbumsLen = useRef(albums.length);
  useLayoutEffect(() => {
    const wasEmpty = prevAlbumsLen.current === 0;
    prevAlbumsLen.current = albums.length;
    if (wasEmpty && albums.length > 0) {
      const el = containerRef.current;
      if (el) setContainerWidth(el.offsetWidth);
    }
  }, [albums.length]);

  const available = containerWidth > 0 ? containerWidth - PADDING * 2 : 0;
  const cols = Math.max(1, Math.floor((available + COL_GAP) / (CARD_MIN + COL_GAP)));
  const cardWidth = available > 0 ? (available - COL_GAP * (cols - 1)) / cols : CARD_MIN;
  const rowHeight = Math.round(cardWidth) + ROW_GAP;
  const rowCount = Math.ceil(albums.length / cols);

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

  const scrubberSections = useMemo(() => {
    if (!sort || sort === "recently_added" || cols === 0) return [];
    const seen = new Set<string>();
    const sections: { label: string; rowIndex: number }[] = [];
    for (let i = 0; i < albums.length; i++) {
      const album = albums[i]!;
      let label: string;
      if (sort === "year") {
        label = album.year ? `${Math.floor(album.year / 10) * 10}s` : "?";
      } else {
        const src = sort === "artist" ? (album.artist ?? album.name) : album.name;
        const stripped = src.replace(/^(The |A |An )/i, "");
        const ch = stripped[0]?.toUpperCase() ?? "#";
        label = /[A-Z]/.test(ch) ? ch : "#";
      }
      if (!seen.has(label)) {
        seen.add(label);
        sections.push({ label, rowIndex: Math.floor(i / cols) });
      }
    }
    return sections;
  }, [albums, sort, cols]);

  return (
    <div className="album-grid-wrapper">
      <div ref={containerRef} className="album-grid-scroller">
        {albums.length === 0 ? (
          <p className="empty-state">{emptyMessage ?? "No albums"}</p>
        ) : (
        <div style={{ height: `${virtualizer.getTotalSize() + PADDING * 2}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowStart = virtualRow.index * cols;
            const rowAlbums = albums.slice(rowStart, rowStart + cols);
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
                {rowAlbums.map((album) => (
                  <div
                    key={album.id}
                    className="album-card"
                    onClick={() => onSelect(album)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onSelect(album)}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, album }); }}
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
          })}
        </div>
        )}
      </div>
      {scrubberSections.length > 1 && (
        <div className="album-grid-scrubber">
          {scrubberSections.map(({ label, rowIndex }) => (
            <button
              key={label}
              className="album-grid-scrubber-item"
              onClick={() => virtualizer.scrollToIndex(rowIndex, { align: "start" })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <button onClick={() => { onSelect(contextMenu.album); setContextMenu(null); }}>
            Open album
          </button>
          {onStartRadio && (
            <StartRadioSubmenu
              onSelect={(mode) => { onStartRadio(contextMenu.album, mode); setContextMenu(null); }}
            />
          )}
        </ContextMenu>
      )}
    </div>
  );
}
