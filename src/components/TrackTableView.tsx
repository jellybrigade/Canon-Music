import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Play, SlidersHorizontal, ChevronUp, ChevronDown } from "lucide-react";
import { useAllTracks, type AllTrackRow } from "../hooks/useAllTracks";
import type { ServerWithCredential } from "../hooks/useServer";
import { makeStreamUrlBuilder } from "../lib/track";
import { getCoverArtUrl } from "../lib/navidrome";
import type { CurrentTrack } from "../store/player";
import { usePlayerStore } from "../store/player";
import { ContextMenu } from "./ContextMenu";
import "./AlbumDetail.css";

const ROW_HEIGHT = 40;

const SECONDS_PER_MINUTE = 60;
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = Math.floor(seconds % SECONDS_PER_MINUTE);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type SortField = "title" | "artist" | "album" | "year" | "duration" | "play_count" | "bit_rate" | "suffix";
type SortDir = "asc" | "desc";

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
  onSelectAlbum?: (albumId: string) => void;
  onSelectArtist?: (artistName: string) => void;
}

export function TrackTableView({ serverWithCredential, onSelectAlbum, onSelectArtist }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: tracks, isLoading } = useAllTracks();

  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

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

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const lastClickedRef = useRef<number | null>(null);

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
        cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      } else {
        cmp = (av as number) < (bv as number) ? -1 : (av as number) > (bv as number) ? 1 : 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [tracks, sortField, sortDir]);

  function handleSortHeader(field: SortField) {
    setSelectedIds(new Set());
    lastClickedRef.current = null;
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function SortIndicator({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return sortDir === "asc"
      ? <ChevronUp size={11} style={{ verticalAlign: "middle", marginLeft: 2 }} />
      : <ChevronDown size={11} style={{ verticalAlign: "middle", marginLeft: 2 }} />;
  }

  function buildTrackObj(track: AllTrackRow): CurrentTrack {
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
  }

  const handleRowClick = useCallback((e: React.MouseEvent, index: number) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (isCtrl) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
      lastClickedRef.current = index;
    } else if (isShift && lastClickedRef.current !== null) {
      const from = Math.min(lastClickedRef.current, index);
      const to = Math.max(lastClickedRef.current, index);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(i);
        return next;
      });
    } else {
      setSelectedIds(new Set());
      lastClickedRef.current = index;
      const startIndex = index;
      playQueue(sorted.map(buildTrackObj), streamUrlFor, startIndex);
    }
  }, [sorted, streamUrlFor, playQueue]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedIds.size > 0) setSelectedIds(new Set());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const gridTemplate = [
    "2.5rem",
    "minmax(0, 2fr)",
    cols.artist ? "minmax(0, 1.25fr)" : null,
    cols.album ? "minmax(0, 1.25fr)" : null,
    cols.year ? "3.5rem" : null,
    cols.genre ? "minmax(0, 1fr)" : null,
    cols.format ? "3.5rem" : null,
    cols.bitrate ? "4.5rem" : null,
    cols.plays ? "3.5rem" : null,
    cols.duration ? "4.5rem" : null,
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
          >Title<SortIndicator field="title" /></button>
          {cols.artist && (
            <button className="playlist-col-header-cell track-sort-btn" onClick={() => handleSortHeader("artist")}>
              Artist<SortIndicator field="artist" />
            </button>
          )}
          {cols.album && (
            <button className="playlist-col-header-cell track-sort-btn" onClick={() => handleSortHeader("album")}>
              Album<SortIndicator field="album" />
            </button>
          )}
          {cols.year && (
            <button className="playlist-col-header-cell track-sort-btn" onClick={() => handleSortHeader("year")}>
              Year<SortIndicator field="year" />
            </button>
          )}
          {cols.genre && <span className="playlist-col-header-cell">Genre</span>}
          {cols.format && (
            <button className="playlist-col-header-cell track-sort-btn" onClick={() => handleSortHeader("suffix")}>
              Format<SortIndicator field="suffix" />
            </button>
          )}
          {cols.bitrate && (
            <button className="playlist-col-header-cell track-sort-btn" onClick={() => handleSortHeader("bit_rate")}>
              Bitrate<SortIndicator field="bit_rate" />
            </button>
          )}
          {cols.plays && (
            <button className="playlist-col-header-cell track-sort-btn playlist-col-header-cell--right" onClick={() => handleSortHeader("play_count")}>
              Plays<SortIndicator field="play_count" />
            </button>
          )}
          {cols.duration && (
            <button className="playlist-col-header-cell track-sort-btn playlist-col-header-cell--right" onClick={() => handleSortHeader("duration")}>
              Duration<SortIndicator field="duration" />
            </button>
          )}
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
          <p className="empty-state">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="empty-state">No tracks in library.</p>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const track = sorted[virtualItem.index]!;
              const isCurrentTrack = currentTrack?.id === track.id;
              const isCurrentlyPlaying = isCurrentTrack && isPlaying;
              const isSelected = selectedIds.has(virtualItem.index);
              return (
                <div
                  key={track.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                    gridTemplateColumns: gridTemplate,
                  }}
                  className={[
                    "playlist-vrow",
                    isCurrentTrack ? "playlist-vrow--active" : "",
                    isSelected ? "track-table-row--selected" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={(e) => handleRowClick(e, virtualItem.index)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, track });
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      playQueue(sorted.map(buildTrackObj), streamUrlFor, virtualItem.index);
                    }
                  }}
                >
                  <span className="playlist-vrow-num">
                    {isCurrentlyPlaying
                      ? <span className="track-playing-indicator"><Play size={12} /></span>
                      : virtualItem.index + 1}
                  </span>
                  <span className="playlist-vrow-title">{track.title}</span>
                  {cols.artist && <span className="playlist-vrow-artist">{track.artist ?? ""}</span>}
                  {cols.album && <span className="playlist-vrow-album">{track.album_name ?? ""}</span>}
                  {cols.year && <span className="playlist-vrow-year">{track.year ?? ""}</span>}
                  {cols.genre && <span className="playlist-vrow-genre">{track.genre ?? ""}</span>}
                  {cols.format && <span className="playlist-vrow-format">{track.suffix ? track.suffix.toUpperCase() : ""}</span>}
                  {cols.bitrate && <span className="playlist-vrow-bitrate">{track.bit_rate ? `${track.bit_rate}k` : ""}</span>}
                  {cols.plays && <span className="playlist-vrow-duration">{track.play_count ?? ""}</span>}
                  {cols.duration && <span className="playlist-vrow-duration">{track.duration ? formatDuration(track.duration) : ""}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <button onClick={() => {
            const idx = sorted.findIndex((t) => t.id === contextMenu.track.id);
            playQueue(sorted.map(buildTrackObj), streamUrlFor, idx >= 0 ? idx : 0);
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
      )}
    </main>
  );
}
