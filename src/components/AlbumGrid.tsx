import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAlbumDisplayName } from "../hooks/useAlbumDisplayName";
import { Heart, CircleHelp } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AlbumRow, AlbumSort } from "../types/library";
import type { ServerWithCredential } from "../hooks/useServer";
import { useLoved } from "../hooks/useLoved";
import { useFailedLookupAlbumIds } from "../hooks/useAlbumIdentity";
import { useBoolSetting } from "../hooks/useSetting";
import { useScrollMemory } from "../hooks/useScrollMemory";
import { getCoverArtUrl } from "../lib/navidrome";
import { useAlbumCoverMap } from "../hooks/useCoverCache";
import { AlbumArt } from "./AlbumArt";
import { ContextMenu, ContextMenuSubmenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import { Pagination } from "./TagsViewHelpers";
import { AlbumIdentifyDialog } from "./IdentifyDialog";
import { CardGridSkeleton } from "./Skeleton";
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
  onAddAlbumToQueue?: (album: AlbumRow) => void;
  onAddAlbumToPlaylist?: (album: AlbumRow, playlist: PlaylistRow) => void;
  playlists?: PlaylistRow[];
  /** Title plus a hint, so a caller-supplied empty state teaches the same way the default
      one does instead of degrading to a single unexplained line. */
  emptyMessage?: { title: string; hint: string };
  sort?: AlbumSort;
  /** True only while there is nothing to show yet - a refresh over existing rows keeps them. */
  isLoading?: boolean;
  /** Set when the read failed. Without it a failure renders as an empty library. */
  error?: string | null;
  onRetry?: () => void;
}

interface CardProps {
  album: AlbumRow;
  coverUrl: string | null;
  serverWithCredential: ServerWithCredential;
  isLoved: boolean;
  showBadge: boolean;
  onSelect: (album: AlbumRow) => void;
  onContextMenu: (x: number, y: number, album: AlbumRow) => void;
  onToggleLove: (albumId: string) => void;
}

const AlbumCard = memo(function AlbumCard({ album, coverUrl, serverWithCredential, isLoved, showBadge, onSelect, onContextMenu, onToggleLove }: CardProps) {
  const albumDisplayName = useAlbumDisplayName();
  const { server, credential } = serverWithCredential;
  // Derive the fallback cover URL here (not inline in the parent's render) and
  // memoize on its stable inputs so the same card gets the same string reference
  // across renders. getCoverArtUrl returns a fresh string each call, which would
  // otherwise defeat this component's React.memo.
  const artUrl = useMemo(
    () => coverUrl ?? (album.artwork_url ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url) : null),
    [coverUrl, album.artwork_url, server.url, server.username, credential],
  );
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
        <div className="album-unidentified-badge" title="Couldn't match on MusicBrainz, click to identify manually">
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

export function AlbumGrid({ albums, serverWithCredential, onSelect, onStartRadio, onAddAlbumToQueue, onAddAlbumToPlaylist, playlists, emptyMessage, sort, isLoading = false, error = null, onRetry }: Props) {
  const coverMap = useAlbumCoverMap();
  const { lovedAlbumIds, toggleAlbumLove } = useLoved();
  const [mbAutoIdentify] = useBoolSetting("mb.auto_identify", true);
  const [paginated] = useBoolSetting("albums.pagination", false);
  const [page, setPage] = useState(1);
  const { data: failedLookupIds } = useFailedLookupAlbumIds();
  const failedLookupSet = useMemo(() => new Set(failedLookupIds ?? []), [failedLookupIds]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; album: AlbumRow } | null>(null);
  const [identifyAlbum, setIdentifyAlbum] = useState<AlbumRow | null>(null);

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
      const yearHeaders = rows.flatMap((row, i) =>
        row.type === "year-header" ? [{ label: row.label, rowIndex: i }] : []
      );
      const seen = new Set<string>();
      const sections: { label: string; rowIndex: number }[] = [];
      for (const { label, rowIndex } of yearHeaders) {
        const year = parseInt(label, 10);
        const bucketLabel = isNaN(year) ? label : `${Math.floor(year / 10) * 10}s`;
        if (!seen.has(bucketLabel)) {
          seen.add(bucketLabel);
          sections.push({ label: bucketLabel, rowIndex });
        }
      }
      return sections;
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

  // The grid's padding is declared to the virtualizer rather than added to each row's `top`
  // by hand. Hand-adding it left every offset the virtualizer computes itself 20px short of
  // where the row was actually painted, so the scrubber's `scrollToIndex` landed its target
  // row tucked under the top edge. One writer for the number.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (i) => rows[i]?.type === "year-header" ? YEAR_HEADER_HEIGHT : rowHeight,
    overscan: 3,
    paddingStart: PADDING,
    paddingEnd: PADDING,
  });

  // Keyed by sort because each sort is a different ordering of the same rows,
  // so an offset taken under one is meaningless under another.
  useScrollMemory(containerRef, `albums:${sort ?? "default"}`, rows.length > 0);

  const prevLayoutKey = useRef(`${cols}-${rowHeight}-${rows.length}`);
  useLayoutEffect(() => {
    const key = `${cols}-${rowHeight}-${rows.length}`;
    if (prevLayoutKey.current !== key) {
      prevLayoutKey.current = key;
      virtualizer.measure();
    }
  }, [cols, rowHeight, rows.length, virtualizer]);

  return (
    <div
      className="album-grid-wrapper"
      style={{ "--album-grid-trailing-space": `${PADDING + ROW_GAP}px` } as CSSProperties}
    >
      <div ref={containerRef} className="album-grid-scroller">
        {/* Error first: a failed read leaves the caller's data undefined, so `isLoading`
            is still true and a skeleton would otherwise pulse forever over the failure.
            Both states are gated on having no rows, so a failed background refresh keeps
            the rows already on screen rather than replacing them with a wall. */}
        {error && albums.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">Couldn't load your albums</p>
            <p className="empty-state-hint">{error}</p>
            {onRetry && <button className="empty-state-action" onClick={onRetry}>Try again</button>}
          </div>
        ) : isLoading && albums.length === 0 ? (
          <CardGridSkeleton
            count={18}
            minWidth={CARD_MIN}
            gap={COL_GAP}
            padding={PADDING}
            label="Loading albums"
          />
        ) : albums.length === 0 ? (
          emptyMessage ? (
            <div className="empty-state">
              <p className="empty-state-title">{emptyMessage.title}</p>
              <p className="empty-state-hint">{emptyMessage.hint}</p>
            </div>
          ) : (
            <div className="empty-state">
              <p className="empty-state-title">No albums here yet</p>
              <p className="empty-state-hint">
                Connect a server in Settings and sync your library to fill this grid.
              </p>
            </div>
          )
        ) : (
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
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
                    top: `${virtualRow.start}px`,
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
                  top: `${virtualRow.start}px`,
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
                    coverUrl={coverMap.get(album.id) ?? null}
                    serverWithCredential={serverWithCredential}
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
          {onAddAlbumToQueue && (
            <button onClick={() => { onAddAlbumToQueue(contextMenu.album); setContextMenu(null); }}>
              Add to Queue
            </button>
          )}
          {onStartRadio && (
            <StartRadioSubmenu
              onSelect={(mode) => { onStartRadio(contextMenu.album, mode); setContextMenu(null); }}
            />
          )}
          <button onClick={() => { handleToggleLove(contextMenu.album.id); setContextMenu(null); }}>
            {lovedAlbumIds.has(contextMenu.album.id) ? "Unlove album" : "Love album"}
          </button>
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
          <button onClick={() => { setIdentifyAlbum(contextMenu.album); setContextMenu(null); }}>
            Identify on MusicBrainz…
          </button>
        </ContextMenu>
      )}
      {identifyAlbum && (
        <AlbumIdentifyDialog
          albumId={identifyAlbum.id}
          artist={identifyAlbum.artist ?? ""}
          album={identifyAlbum.name}
          onClose={() => setIdentifyAlbum(null)}
        />
      )}
    </div>
  );
}
