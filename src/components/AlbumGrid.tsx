import { memo, useCallback, useMemo, useState, type CSSProperties } from "react";
import { useAlbumDisplayName } from "../hooks/useAlbumDisplayName";
import { useGridPagination } from "../hooks/useGridPagination";
import { Heart, CircleHelp } from "lucide-react";
import type { AlbumRow, AlbumSort } from "../types/library";
import { useScrollMemory } from "../hooks/useScrollMemory";
import type { ServerWithCredential } from "../hooks/useServer";
import { useLoved } from "../hooks/useLoved";
import { useFailedLookupAlbumIds } from "../hooks/useAlbumIdentity";
import { useBoolSetting } from "../hooks/useSetting";
import { getCoverArtUrl } from "../lib/navidrome";
import { useAlbumCoverMap } from "../hooks/useCoverCache";
import { AlbumArt } from "./AlbumArt";
import { ContextMenu, ContextMenuSubmenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import { Pagination } from "./TagsViewHelpers";
import { AlbumIdentifyDialog } from "./IdentifyDialog";
import type { RadioMode } from "../store/player";
import type { PlaylistRow } from "../hooks/usePlaylists";
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
  onAddAlbumToQueue?: (album: AlbumRow) => void;
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

export function AlbumGrid({ albums, serverWithCredential, onSelect, onStartRadio, onAddAlbumToQueue, onAddAlbumToPlaylist, playlists, emptyMessage, scrollKey, sort }: Props) {
  const { server, credential } = serverWithCredential;
  const coverMap = useAlbumCoverMap();
  const { lovedAlbumIds, toggleAlbumLove } = useLoved();
  const [mbAutoIdentify] = useBoolSetting("mb.auto_identify", false);
  const { data: failedLookupIds } = useFailedLookupAlbumIds();
  const failedLookupSet = useMemo(() => new Set(failedLookupIds ?? []), [failedLookupIds]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; album: AlbumRow } | null>(null);
  const [identifyAlbum, setIdentifyAlbum] = useState<AlbumRow | null>(null);

  const { containerRef, cols, cardWidth, page, setPage, pageSize } = useGridPagination(albums.length, {
    padding: PADDING,
    colGap: COL_GAP,
    cardMin: CARD_MIN,
    resetKey: sort,
  });

  useScrollMemory(scrollKey, containerRef);

  const handleSelect = useCallback((album: AlbumRow) => onSelect(album), [onSelect]);
  const handleContextMenu = useCallback((x: number, y: number, album: AlbumRow) => {
    setContextMenu({ x, y, album });
  }, []);
  const handleToggleLove = useCallback((albumId: string) => {
    void toggleAlbumLove(albumId, serverWithCredential);
  }, [toggleAlbumLove, serverWithCredential]);

  const visibleAlbums = albums.slice((page - 1) * pageSize, page * pageSize);

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

  return (
    <div
      className="album-grid-wrapper"
      style={{ "--album-grid-trailing-space": `${PADDING + ROW_GAP}px` } as CSSProperties}
    >
      <div ref={containerRef} className="album-grid-scroller">
        {albums.length === 0 ? (
          <p className="empty-state">{emptyMessage ?? "No albums"}</p>
        ) : (
        <div style={{ padding: `${PADDING}px`, display: "flex", flexDirection: "column", gap: `${ROW_GAP}px` }}>
          {rows.map((row, i) => {
            if (row.type === "year-header") {
              return (
                <div key={`yh-${i}`} className="year-group-header" style={{ height: `${YEAR_HEADER_HEIGHT}px` }}>
                  {row.label}
                </div>
              );
            }

            return (
              <div
                key={`al-${i}`}
                style={{
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
                    artUrl={coverMap.get(album.id) ?? (album.artwork_url ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url) : null)}
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
      {albums.length > pageSize && (
        <div className="album-grid-pagination">
          <Pagination page={page} total={albums.length} pageSize={pageSize} onChange={setPage} />
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
