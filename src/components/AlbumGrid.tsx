import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAlbumDisplayName } from "../hooks/useAlbumDisplayName";
import { Heart, CircleHelp } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AlbumRow, AlbumSort } from "../types/library";
import { useScrollMemory } from "../hooks/useScrollMemory";
import type { ServerWithCredential } from "../hooks/useServer";
import { useLoved } from "../hooks/useLoved";
import { useFailedLookupAlbumIds } from "../hooks/useAlbumIdentity";
import { useBoolSetting } from "../hooks/useSetting";
import { getCoverArtUrl } from "../lib/navidrome";
import { AlbumArt } from "./AlbumArt";
import { ContextMenu, ContextMenuSubmenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import { Pagination } from "./TagsViewHelpers";
import type { RadioMode } from "../store/player";
import type { PlaylistRow } from "../hooks/usePlaylists";
import "./AlbumGrid.css";

const PAGE_SIZE = 100;

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
  onAddAlbumToPlaylist?: (album: AlbumRow, playlist: PlaylistRow) => void;
  playlists?: PlaylistRow[];
  emptyMessage?: string;
  scrollKey?: string;
  sort?: AlbumSort;
}

interface CardProps {
  album: AlbumRow;
  artUrl: string | null;
  isLoved: boolean;
  showBadge: boolean;
  onSelect: (album: AlbumRow) => void;
  onContextMenu: (x: number, y: number, album: AlbumRow) => void;
  onToggleLove: (albumId: string) => void;
}

const AlbumCard = memo(function AlbumCard({ album, artUrl, isLoved, showBadge, onSelect, onContextMenu, onToggleLove }: CardProps) {
  const albumDisplayName = useAlbumDisplayName();
  return (
    <div
      className="album-card"
      onClick={() => onSelect(album)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect(album)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e.clientX, e.clientY, album); }}
    >
      {artUrl ? (
        <AlbumArt
          src={artUrl}
          artist={album.artist}
          album={album.name}
          alt={album.name}
          className="album-art"
          decoding="async"
          loading="lazy"
        />
      ) : (
        <div className="album-art album-art--placeholder" />
      )}
      <button
        className={`album-heart${isLoved ? " album-heart--loved" : ""}`}
        aria-label={isLoved ? "Unlove album" : "Love album"}
        onClick={(e) => { e.stopPropagation(); onToggleLove(album.id); }}
      >
        <Heart size={16} fill={isLoved ? "currentColor" : "none"} strokeWidth={2} />
      </button>
      {showBadge && (
        <div className="album-unidentified-badge" title="Couldn't match on MusicBrainz — click to identify manually">
          <CircleHelp size={13} />
        </div>
      )}
      <div className="album-overlay">
        <span className="album-name">{albumDisplayName(album.name, album.id)}</span>
        {album.artist && <span className="album-artist">{album.artist}</span>}
      </div>
    </div>
  );
});

export function AlbumGrid({ albums, serverWithCredential, onSelect, onStartRadio, onAddAlbumToPlaylist, playlists, emptyMessage, scrollKey, sort }: Props) {
  const { server, credential } = serverWithCredential;
  const { lovedAlbumIds, toggleAlbumLove } = useLoved();
  const [mbAutoIdentify] = useBoolSetting("mb.auto_identify", false);
  const [paginated] = useBoolSetting("albums.pagination", false);
  const [page, setPage] = useState(1);
  const { data: failedLookupIds } = useFailedLookupAlbumIds();
  const failedLookupSet = useMemo(() => new Set(failedLookupIds ?? []), [failedLookupIds]);
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

  const handleSelect = useCallback((album: AlbumRow) => onSelect(album), [onSelect]);
  const handleContextMenu = useCallback((x: number, y: number, album: AlbumRow) => {
    setContextMenu({ x, y, album });
  }, []);
  const handleToggleLove = useCallback((albumId: string) => {
    void toggleAlbumLove(albumId, serverWithCredential);
  }, [toggleAlbumLove, serverWithCredential]);

  // Reset to page 1 when sort/filter changes
  const prevAlbumsLen = useRef(albums.length);
  useLayoutEffect(() => {
    const wasEmpty = prevAlbumsLen.current === 0;
    prevAlbumsLen.current = albums.length;
    if (wasEmpty && albums.length > 0) {
      const el = containerRef.current;
      if (el) setContainerWidth(el.offsetWidth);
    }
  }, [albums.length]);

  useEffect(() => { setPage(1); }, [paginated, sort]);

  const visibleAlbums = paginated
    ? albums.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : albums;

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
      for (const album of visibleAlbums) {
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
    for (let i = 0; i < visibleAlbums.length; i += cols)
      result.push({ type: "albums", items: visibleAlbums.slice(i, i + cols) });
    return result;
  }, [visibleAlbums, sort, cols]);

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
                  <AlbumCard
                    key={album.id}
                    album={album}
                    artUrl={album.artwork_url ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url) : null}
                    isLoved={lovedAlbumIds.has(album.id)}
                    showBadge={mbAutoIdentify && failedLookupSet.has(album.id)}
                    onSelect={handleSelect}
                    onContextMenu={handleContextMenu}
                    onToggleLove={handleToggleLove}
                  />
                ))}
              </div>
            );
          })}
        </div>
        )}
      </div>
      {!paginated && scrubberSections.length > 1 && (
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
      {paginated && albums.length > PAGE_SIZE && (
        <div className="album-grid-pagination">
          <Pagination page={page} total={albums.length} pageSize={PAGE_SIZE} onChange={(p) => { setPage(p); containerRef.current?.scrollTo({ top: 0 }); }} />
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
          {onAddAlbumToPlaylist && playlists && playlists.length > 0 && (
            <ContextMenuSubmenu label="Add to Playlist">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => { onAddAlbumToPlaylist(contextMenu.album, pl); setContextMenu(null); }}
                >
                  {pl.name}
                </button>
              ))}
            </ContextMenuSubmenu>
          )}
        </ContextMenu>
      )}
    </div>
  );
}
