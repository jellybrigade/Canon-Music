import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Play, Heart, SlidersHorizontal, ChevronUp, ChevronDown } from "lucide-react";
import type { AllTrackRow } from "../hooks/useAllTracks";
import type { ServerWithCredential } from "../hooks/useServer";
import { makeStreamUrlBuilder } from "../lib/track";
import { getCoverArtUrl } from "../lib/navidrome";
import type { CurrentTrack } from "../store/player";
import { usePlayerStore } from "../store/player";
import { useLoved } from "../hooks/useLoved";
import { useScrollMemory } from "../hooks/useScrollMemory";
import { useGenreMappings, applyGenreMappings } from "../hooks/useGenreDisplay";
import { ContextMenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import "./AlbumDetail.css";
import "./AlbumGrid.css";

const ROW_HEIGHT = 40;
const SKELETON_ROWS = 14;

// One reused collator instead of String.prototype.localeCompare, which constructs a fresh
// collator on every call. The sort runs over the whole library, so on a large one that is
// hundreds of thousands of constructions per sort change.
const collator = new Intl.Collator(undefined, { sensitivity: "base" });

const SECONDS_PER_MINUTE = 60;
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = Math.floor(seconds % SECONDS_PER_MINUTE);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type SortField = "title" | "artist" | "album" | "year" | "duration" | "play_count" | "bit_rate" | "suffix";
type SortDir = "asc" | "desc";

// Declared at module scope: a component defined inside the render body is a new component
// type on every render, so React would tear the chevron down and remount it each pass
// instead of updating it.
function SortIndicator({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (sortField !== field) return null;
  return sortDir === "asc"
    ? <ChevronUp size={11} style={{ verticalAlign: "middle", marginLeft: 2 }} />
    : <ChevronDown size={11} style={{ verticalAlign: "middle", marginLeft: 2 }} />;
}

interface TrackCols {
  artist: boolean;
  album: boolean;
  year: boolean;
  genre: boolean;
  duration: boolean;
  plays: boolean;
  format: boolean;
  bitrate: boolean;
}

const COL_DEFAULTS: TrackCols = {
  artist: true,
  album: true,
  year: false,
  genre: false,
  duration: true,
  plays: false,
  format: false,
  bitrate: false,
};

interface Props {
  serverWithCredential: ServerWithCredential;
  tracks: AllTrackRow[] | undefined;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelectAlbum?: (albumId: string) => void;
  onSelectArtist?: (artistName: string) => void;
}

interface TrackRowProps {
  track: AllTrackRow;
  index: number;
  start: number;
  gridTemplate: string;
  cols: TrackCols;
  genreMappings: ReturnType<typeof useGenreMappings>;
  isCurrentTrack: boolean;
  isCurrentlyPlaying: boolean;
  isSelected: boolean;
  isLoved: boolean;
  onRowClick: (e: React.MouseEvent, index: number) => void;
  onRowContextMenu: (e: React.MouseEvent, track: AllTrackRow) => void;
  onRowEnter: (index: number) => void;
  onToggleLove: (trackId: string) => void;
}

const TrackRow = memo(function TrackRow({
  track,
  index,
  start,
  gridTemplate,
  cols,
  genreMappings,
  isCurrentTrack,
  isCurrentlyPlaying,
  isSelected,
  isLoved,
  onRowClick,
  onRowContextMenu,
  onRowEnter,
  onToggleLove,
}: TrackRowProps) {
  return (
    <div
      data-index={index}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        transform: `translateY(${start}px)`,
        gridTemplateColumns: gridTemplate,
      }}
      className={[
        "playlist-vrow",
        isCurrentTrack ? "playlist-vrow--active" : "",
        isSelected ? "track-table-row--selected" : "",
      ].filter(Boolean).join(" ")}
      onClick={(e) => onRowClick(e, index)}
      onContextMenu={(e) => onRowContextMenu(e, track)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onRowEnter(index);
      }}
    >
      <span className="playlist-vrow-num">
        {isCurrentlyPlaying
          ? <span className="track-playing-indicator"><Play size={12} /></span>
          : index + 1}
      </span>
      <span className="playlist-vrow-title">{track.title}</span>
      {cols.artist && <span className="playlist-vrow-artist">{track.artist ?? ""}</span>}
      {cols.album && <span className="playlist-vrow-album">{track.album_name ?? ""}</span>}
      {cols.year && <span className="playlist-vrow-year">{track.year ?? ""}</span>}
      {cols.genre && <span className="playlist-vrow-genre">{applyGenreMappings(track.genre, genreMappings).join(", ")}</span>}
      {cols.format && <span className="playlist-vrow-format">{track.suffix ? track.suffix.toUpperCase() : ""}</span>}
      {cols.bitrate && <span className="playlist-vrow-bitrate">{track.bit_rate ? `${track.bit_rate}k` : ""}</span>}
      {cols.plays && <span className="playlist-vrow-duration">{track.play_count ?? ""}</span>}
      {cols.duration && <span className="playlist-vrow-duration">{track.duration ? formatDuration(track.duration) : ""}</span>}
      <button
        className={`track-heart${isLoved ? " track-heart--loved" : ""}`}
        aria-label={isLoved ? "Unlove track" : "Love track"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleLove(track.id);
        }}
      >
        <Heart size={15} fill={isLoved ? "currentColor" : "none"} strokeWidth={2} />
      </button>
    </div>
  );
});

export function TrackTableView({ serverWithCredential, tracks, isLoading, error, onRetry, onSelectAlbum, onSelectArtist }: Props) {
  const { server, credential } = serverWithCredential;
  const genreMappings = useGenreMappings();

  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const addManyToQueue = usePlayerStore((s) => s.addManyToQueue);
  const playNextMany = usePlayerStore((s) => s.playNextMany);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const { lovedTrackIds, toggleTrackLove } = useLoved();

  const streamUrlFor = useMemo(() => makeStreamUrlBuilder(server, credential), [server, credential]);

  const [sortField, setSortField] = useState<SortField>("artist");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [cols, setCols] = useState<TrackCols>(() => {
    try {
      return { ...COL_DEFAULTS, ...JSON.parse(localStorage.getItem("canon-track-table-cols") ?? "null") };
    } catch {
      return COL_DEFAULTS;
    }
  });
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("canon-track-table-cols", JSON.stringify(cols));
  }, [cols]);

  useEffect(() => {
    if (!showColPicker) return;
    const close = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) setShowColPicker(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showColPicker]);

  // Keyed by track id, not row index: a background refresh (or a re-sort) reorders the
  // rows, and an index-keyed selection would silently come to mean different tracks.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // The shift-range anchor is a track id for the same reason the selection is. Held as an
  // index it survived a refresh pointing at whatever track landed on that row, so a range
  // extended after a sync covered tracks the user never anchored on.
  const lastClickedIdRef = useRef<string | null>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: AllTrackRow } | null>(null);

  const sorted = useMemo(() => {
    if (!tracks) return [];
    return [...tracks].sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      switch (sortField) {
        case "title": av = a.title; bv = b.title; break;
        case "artist": av = a.artist; bv = b.artist; break;
        case "album": av = a.album_name; bv = b.album_name; break;
        case "year": av = a.year; bv = b.year; break;
        case "duration": av = a.duration; bv = b.duration; break;
        case "play_count": av = a.play_count; bv = b.play_count; break;
        case "bit_rate": av = a.bit_rate; bv = b.bit_rate; break;
        case "suffix": av = a.suffix; bv = b.suffix; break;
      }
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      let cmp: number;
      if (typeof av === "string" && typeof bv === "string") {
        cmp = collator.compare(av, bv);
      } else {
        cmp = (av as number) < (bv as number) ? -1 : (av as number) > (bv as number) ? 1 : 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [tracks, sortField, sortDir]);

  function handleSortHeader(field: SortField) {
    setSelectedIds(new Set());
    lastClickedIdRef.current = null;
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const buildTrackObj = useCallback((track: AllTrackRow): CurrentTrack => {
    const coverArtUrl = track.album_artwork_url
      ? getCoverArtUrl(server.url, server.username, credential, track.album_artwork_url, 64)
      : null;
    return {
      id: track.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      coverArtUrl,
      artworkRef: track.album_artwork_url ?? null,
      album: track.album_name,
      albumId: track.album_id,
      replayGain: (track.replay_gain_track_gain != null || track.replay_gain_album_gain != null)
        ? {
            trackGain: track.replay_gain_track_gain,
            trackPeak: track.replay_gain_track_peak,
            albumGain: track.replay_gain_album_gain,
            albumPeak: track.replay_gain_album_peak,
          }
        : null,
    };
  }, [server, credential]);

  // Build the full queue of playable track objects once per (sorted, builder) change,
  // so a single row click / Enter / "Play Now" no longer re-maps the entire library.
  const trackObjs = useMemo(() => sorted.map(buildTrackObj), [sorted, buildTrackObj]);

  const handleRowClick = useCallback((e: React.MouseEvent, index: number) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    const id = sorted[index]?.id;
    if (id === undefined) return;

    if (isCtrl) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastClickedIdRef.current = id;
      return;
    }

    if (isShift) {
      const anchorId = lastClickedIdRef.current;
      const anchorIndex = anchorId === null ? -1 : sorted.findIndex((t) => t.id === anchorId);
      // No usable anchor - either the first interaction, or the anchored track is gone
      // after a refresh. Select the clicked row and anchor there. A modifier click is a
      // selection gesture, so it must not fall through to the playback branch.
      const from = anchorIndex < 0 ? index : Math.min(anchorIndex, index);
      const to = anchorIndex < 0 ? index : Math.max(anchorIndex, index);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) {
          const rowId = sorted[i]?.id;
          if (rowId !== undefined) next.add(rowId);
        }
        return next;
      });
      if (anchorIndex < 0) lastClickedIdRef.current = id;
      return;
    }

    setSelectedIds(new Set());
    lastClickedIdRef.current = id;
    playQueue(trackObjs, streamUrlFor, index);
  }, [sorted, trackObjs, streamUrlFor, playQueue]);

  const handleRowContextMenu = useCallback((e: React.MouseEvent, track: AllTrackRow) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, track });
  }, []);

  const handleRowEnter = useCallback((index: number) => {
    playQueue(trackObjs, streamUrlFor, index);
  }, [trackObjs, streamUrlFor, playQueue]);

  const handleToggleLove = useCallback((trackId: string) => {
    void toggleTrackLove(trackId, serverWithCredential);
  }, [toggleTrackLove, serverWithCredential]);

  // Functional update rather than reading selectedIds, so the listener is registered once
  // for the life of the view instead of being torn down and re-added on every selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setSelectedIds((prev) => (prev.size > 0 ? new Set() : prev));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Rows are a fixed ROW_HEIGHT, so estimateSize is exact and no row is measured. Passing
  // virtualizer.measureElement as a row ref would put the virtualizer into dynamic mode
  // and cost a ResizeObserver per visible row for a height already known.
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  useScrollMemory(scrollRef, `tracks:${sortField}:${sortDir}`, sorted.length > 0);

  // Right-clicking a row that is part of a multi-row selection acts on the whole
  // selection; right-clicking anywhere else acts on that one row and leaves the
  // selection alone. Built in visible order so the queue matches what the user sees.
  const bulkTarget = useMemo(() => {
    if (!contextMenu || !selectedIds.has(contextMenu.track.id)) return null;
    // Counted against the rows actually in view, not against selectedIds: a refresh drops
    // tracks without their ids leaving the set, and gating on the raw size opened a bulk
    // menu reading "Play 1 tracks" over a selection of one.
    const rows = sorted.filter((t) => selectedIds.has(t.id));
    if (rows.length < 2) return null;
    return rows.map(buildTrackObj);
  }, [contextMenu, selectedIds, sorted, buildTrackObj]);

  const numColWidth = `${Math.max(2, String(sorted.length).length) + 1.5}ch`;

  const gridTemplate = [
    numColWidth,
    "minmax(0, 2fr)",
    cols.artist ? "minmax(0, 1.25fr)" : null,
    cols.album ? "minmax(0, 1.25fr)" : null,
    cols.year ? "3.5rem" : null,
    cols.genre ? "minmax(0, 1fr)" : null,
    cols.format ? "3.5rem" : null,
    cols.bitrate ? "4.5rem" : null,
    cols.plays ? "3.5rem" : null,
    cols.duration ? "4.5rem" : null,
    "2rem",
  ].filter(Boolean).join(" ");

  return (
    <main className="library" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header className="library-header">
        <h1 className="library-header-title" style={{ fontSize: "1rem", fontWeight: 600 }}>Tracks</h1>
        {tracks && (
          <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginLeft: "0.5rem" }}>
            {tracks.length.toLocaleString()}
          </span>
        )}
      </header>

      <div className="playlist-list-controls">
        <div className="playlist-col-header" style={{ gridTemplateColumns: gridTemplate }}>
          <span className="playlist-col-header-cell">#</span>
          <button
            className="playlist-col-header-cell track-sort-btn"
            onClick={() => handleSortHeader("title")}
          >Title<SortIndicator field="title" sortField={sortField} sortDir={sortDir} /></button>
          {cols.artist && (
            <button className="playlist-col-header-cell track-sort-btn" onClick={() => handleSortHeader("artist")}>
              Artist<SortIndicator field="artist" sortField={sortField} sortDir={sortDir} />
            </button>
          )}
          {cols.album && (
            <button className="playlist-col-header-cell track-sort-btn" onClick={() => handleSortHeader("album")}>
              Album<SortIndicator field="album" sortField={sortField} sortDir={sortDir} />
            </button>
          )}
          {cols.year && (
            <button className="playlist-col-header-cell track-sort-btn" onClick={() => handleSortHeader("year")}>
              Year<SortIndicator field="year" sortField={sortField} sortDir={sortDir} />
            </button>
          )}
          {cols.genre && <span className="playlist-col-header-cell">Genre</span>}
          {cols.format && (
            <button className="playlist-col-header-cell track-sort-btn" onClick={() => handleSortHeader("suffix")}>
              Format<SortIndicator field="suffix" sortField={sortField} sortDir={sortDir} />
            </button>
          )}
          {cols.bitrate && (
            <button className="playlist-col-header-cell track-sort-btn" onClick={() => handleSortHeader("bit_rate")}>
              Bitrate<SortIndicator field="bit_rate" sortField={sortField} sortDir={sortDir} />
            </button>
          )}
          {cols.plays && (
            <button className="playlist-col-header-cell track-sort-btn playlist-col-header-cell--right" onClick={() => handleSortHeader("play_count")}>
              Plays<SortIndicator field="play_count" sortField={sortField} sortDir={sortDir} />
            </button>
          )}
          {cols.duration && (
            <button className="playlist-col-header-cell track-sort-btn playlist-col-header-cell--right" onClick={() => handleSortHeader("duration")}>
              Duration<SortIndicator field="duration" sortField={sortField} sortDir={sortDir} />
            </button>
          )}
          <span className="playlist-col-header-cell" />
        </div>
        <div className="tracklist-col-picker-anchor" ref={colPickerRef}>
          <button
            className="tracklist-col-picker-btn"
            title="Show/hide columns"
            onClick={() => setShowColPicker((v) => !v)}
          >
            <SlidersHorizontal size={13} />
          </button>
          {showColPicker && (
            <div className="tracklist-col-picker-popup">
              {(
                [
                  ["artist", "Artist"],
                  ["album", "Album"],
                  ["year", "Year"],
                  ["genre", "Genre"],
                  ["duration", "Duration"],
                  ["plays", "Plays"],
                  ["format", "Format"],
                  ["bitrate", "Bitrate"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={cols[key]}
                    onChange={(e) => setCols((c) => ({ ...c, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="album-detail-body"
        style={{ flex: 1, overflow: "auto" }}
      >
        {isLoading ? (
          <div className="track-skeleton-list" aria-label="Loading tracks" aria-busy="true">
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <div key={i} className="track-skeleton-row" style={{ gridTemplateColumns: gridTemplate }}>
                <span className="track-skeleton-bar track-skeleton-bar--num" />
                <span className="track-skeleton-bar" />
                {cols.artist && <span className="track-skeleton-bar" />}
                {cols.album && <span className="track-skeleton-bar" />}
                {cols.year && <span className="track-skeleton-bar" />}
                {cols.genre && <span className="track-skeleton-bar" />}
                {cols.format && <span className="track-skeleton-bar" />}
                {cols.bitrate && <span className="track-skeleton-bar" />}
                {cols.plays && <span className="track-skeleton-bar" />}
                {cols.duration && <span className="track-skeleton-bar" />}
                <span />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="empty-state">
            <p className="empty-state-title">Couldn't load your tracks</p>
            <p className="empty-state-hint">{error}</p>
            <button className="empty-state-action" onClick={onRetry}>Try again</button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">No tracks yet</p>
            <p className="empty-state-hint">
              Sync a server from Settings and every track in your library shows up here, sortable by
              any column.
            </p>
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const track = sorted[virtualItem.index]!;
              const isCurrentTrack = currentTrack?.id === track.id;
              return (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={virtualItem.index}
                  start={virtualItem.start}
                  gridTemplate={gridTemplate}
                  cols={cols}
                  genreMappings={genreMappings}
                  isCurrentTrack={isCurrentTrack}
                  isCurrentlyPlaying={isCurrentTrack && isPlaying}
                  isSelected={selectedIds.has(track.id)}
                  isLoved={lovedTrackIds.has(track.id)}
                  onRowClick={handleRowClick}
                  onRowContextMenu={handleRowContextMenu}
                  onRowEnter={handleRowEnter}
                  onToggleLove={handleToggleLove}
                />
              );
            })}
          </div>
        )}
      </div>

      {contextMenu && (bulkTarget ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <button onClick={() => {
            void playQueue(bulkTarget, streamUrlFor, 0);
            setContextMenu(null);
          }}>
            Play {bulkTarget.length} tracks
          </button>
          <button onClick={() => {
            playNextMany(bulkTarget, streamUrlFor);
            setContextMenu(null);
          }}>
            Play Next
          </button>
          <button onClick={() => {
            addManyToQueue(bulkTarget, streamUrlFor);
            setContextMenu(null);
          }}>
            Add to Queue
          </button>
          <button onClick={() => {
            for (const t of bulkTarget) {
              if (!lovedTrackIds.has(t.id)) void toggleTrackLove(t.id, serverWithCredential);
            }
            setContextMenu(null);
          }}>
            Love {bulkTarget.length} tracks
          </button>
          <button onClick={() => {
            setSelectedIds(new Set());
            setContextMenu(null);
          }}>
            Clear selection
          </button>
        </ContextMenu>
      ) : (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <button onClick={() => {
            const idx = sorted.findIndex((t) => t.id === contextMenu.track.id);
            playQueue(trackObjs, streamUrlFor, idx >= 0 ? idx : 0);
            setContextMenu(null);
          }}>
            Play Now
          </button>
          <button onClick={() => {
            playNext(buildTrackObj(contextMenu.track), streamUrlFor);
            setContextMenu(null);
          }}>
            Play Next
          </button>
          <button onClick={() => {
            addToQueue(buildTrackObj(contextMenu.track), streamUrlFor);
            setContextMenu(null);
          }}>
            Add to Queue
          </button>
          <StartRadioSubmenu
            onSelect={(mode) => {
              const track = buildTrackObj(contextMenu.track);
              void playQueue([track], streamUrlFor, 0);
              startRadio(track, mode);
              setContextMenu(null);
            }}
          />
          {onSelectAlbum && (
            <button onClick={() => {
              onSelectAlbum(contextMenu.track.album_id);
              setContextMenu(null);
            }}>
              Go to Album
            </button>
          )}
          {onSelectArtist && contextMenu.track.artist && (
            <button onClick={() => {
              onSelectArtist(contextMenu.track.artist!);
              setContextMenu(null);
            }}>
              Go to Artist
            </button>
          )}
        </ContextMenu>
      ))}
    </main>
  );
}
