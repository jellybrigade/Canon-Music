import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Heart, AlertTriangle } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AlbumRow, AlbumSort } from "../hooks/useAlbums";
import { useScrollMemory } from "../hooks/useScrollMemory";
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
const YEAR_HEADER_HEIGHT = 38;

type GridRow =
  | { type: "year-header"; label: string }
  | { type: "albums"; items: AlbumRow[] };

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

  useScrollMemory(scrollKey, containerRef);

  // Re-measure when albums transition from empty to non-empty
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

  // Build mixed rows: year-header rows interleaved with album rows when sort=year
  const rows = useMemo<GridRow[]>(() => {
    if (cols === 0) return [];
    if (sort === "year") {
      const result: GridRow[] = [];
      let batch: AlbumRow[] = [];
      let lastYear: number | null | "unset" = "unset";
      const flush = () => {
        for (let i = 0; i < batch.length; i += cols)
          result.push({ type: "albums", items: batch.slice(i, i + cols) });
        batch = [];
      };
      for (const album of albums) {
        if (album.year !== lastYear) {
          flush();
          result.push({ type: "year-header", label: album.year ? String(album.year) : "Unknown" });
          lastYear = album.year;
        }
        batch.push(album);
      }
      flush();
      return result;
    }
    const result: GridRow[] = [];
    for (let i = 0; i < albums.length; i += cols)
      result.push({ type: "albums", items: albums.slice(i, i + cols) });
    return result;
  }, [albums, sort, cols]);

  const scrubberSections = useMemo(() => {
    if (!sort || sort === "recently_added" || cols === 0) return [];
    if (sort === "year") {
      return rows.flatMap((row, i) =>
        row.type === "year-header" ? [{ label: row.label, rowIndex: i }] : []
      );
    }
    const seen = new Set<string>();
    const sections: { label: string; rowIndex: number }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (row.type !== "albums") continue;
      const album = row.items[0];
      if (!album) continue;
      const src = sort === "artist" ? (album.artist ?? album.name) : album.name;
      const ch = src[0]?.toUpperCase() ?? "#";
      const label = /[A-Z]/.test(ch) ? ch : "#";
      if (!seen.has(label)) {
        seen.add(label);
        sections.push({ label, rowIndex: i });
      }
    }
    return sections;
  }, [rows, sort, cols]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (i) => rows[i]?.type === "year-header" ? YEAR_HEADER_HEIGHT : rowHeight,
    overscan: 3,
  });

  const prevLayoutKey = useRef(`${cols}-${rowHeight}-${rows.length}`);
  useLayoutEffect(() => {
    const key = `${cols}-${rowHeight}-${rows.length}`;
    if (prevLayoutKey.current !== key) {
      prevLayoutKey.current = key;
      virtualizer.measure();
    }
  }, [cols, rowHeight, rows.length, virtualizer]);

  return (
    <div className="album-grid-wrapper">
      <div ref={containerRef} className="album-grid-scroller">
        {albums.length === 0 ? (
          <p className="empty-state">{emptyMessage ?? "No albums"}</p>
        ) : (
        <div style={{ height: `${virtualizer.getTotalSize() + PADDING * 2}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;

            if (row.type === "year-header") {
              return (
                <div
                  key={virtualRow.key}
                  className="year-group-header"
                  style={{
                    position: "absolute",
                    top: `${PADDING + virtualRow.start}px`,
                    left: `${PADDING}px`,
                    right: `${PADDING}px`,
                    height: `${YEAR_HEADER_HEIGHT}px`,
                  }}
                >
                  {row.label}
                </div>
              );
            }

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
                {row.items.map((album) => (
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
                        decoding="async"
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
                        size={16}
                        fill={lovedAlbumIds.has(album.id) ? "currentColor" : "none"}
                        strokeWidth={2}
                      />
                    </button>
                    {offTreeSet.has(album.id) && (
                      <div className="album-off-tree-badge" title="Has unmapped genre tags — open Tags view to resolve">
                        <AlertTriangle size={13} />
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
