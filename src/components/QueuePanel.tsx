import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { X, GripVertical, Play, Search } from "lucide-react";
import { usePlayerStore } from "../store/player";
import { getCoverArtUrl } from "../lib/navidrome";
import { ContextMenu } from "./ContextMenu";
import { RadioChip } from "./RadioChip";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import { useSidebarResize } from "../hooks/useSidebarResize";
import type { ServerWithCredential } from "../hooks/useServer";
import "./QueuePanel.css";

type ContextMenuState = { x: number; y: number; position: number } | null;

const QUEUE_ROW_HEIGHT = 52;
const DND_MAX_QUEUE = 300;

interface QueuePanelProps {
  serverWithCred?: ServerWithCredential;
}

const MIN_QUEUE_WIDTH = 200;
const MAX_QUEUE_WIDTH = 500;
const DEFAULT_QUEUE_WIDTH = 280;

export function QueuePanel({ serverWithCred }: QueuePanelProps) {
  const queue              = usePlayerStore((s) => s.queue);
  const queueIndex         = usePlayerStore((s) => s.queueIndex);
  const isShuffled         = usePlayerStore((s) => s.isShuffled);
  const shuffleOrder       = usePlayerStore((s) => s.shuffleOrder);
  const isQueueOpen        = usePlayerStore((s) => s.isQueueOpen);
  const toggleQueue        = usePlayerStore((s) => s.toggleQueue);
  const removeFromQueue    = usePlayerStore((s) => s.removeFromQueue);
  const removeManyFromQueue = usePlayerStore((s) => s.removeManyFromQueue);
  const moveQueueItem      = usePlayerStore((s) => s.moveQueueItem);
  const playFromQueueIndex = usePlayerStore((s) => s.playFromQueueIndex);
  const startRadio         = usePlayerStore((s) => s.startRadio);

  const { liveWidth, savedWidth, handleMouseDown: handleResizeMouseDown } = useSidebarResize({
    direction: "rtl",
    min: MIN_QUEUE_WIDTH,
    max: MAX_QUEUE_WIDTH,
    settingKey: "queue.panel_width",
    defaultWidth: DEFAULT_QUEUE_WIDTH,
  });
  const panelWidth = liveWidth ?? savedWidth;

  useEffect(() => {
    if (!isQueueOpen) return;
    document.documentElement.style.setProperty("--queue-panel-width", `${panelWidth}px`);
    return () => { document.documentElement.style.removeProperty("--queue-panel-width"); };
  }, [panelWidth, isQueueOpen]);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedPositions, setSelectedPositions] = useState<Set<number>>(new Set());
  const filterInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastClickedRef = useRef<number | null>(null);

  // Clear selection when filter activates or queue changes size
  useEffect(() => {
    if (filter) setSelectedPositions(new Set());
  }, [filter]);
  useEffect(() => {
    setSelectedPositions(new Set());
  }, [queue.length]);

  const orderedTracks = useMemo(
    () => Array.from({ length: queue.length }, (_, i) => {
      const idx = isShuffled && shuffleOrder.length > 0 ? (shuffleOrder[i] ?? i) : i;
      return { position: i, track: queue[idx]! };
    }),
    [queue, isShuffled, shuffleOrder]
  );

  const filterLower = filter.toLowerCase();
  const visibleTracks = useMemo(
    () => filter
      ? orderedTracks.filter(({ track }) =>
          track.title.toLowerCase().includes(filterLower) ||
          (track.artist ?? "").toLowerCase().includes(filterLower)
        )
      : orderedTracks,
    [orderedTracks, filter, filterLower]
  );

  const dndEnabled = !filter && queue.length <= DND_MAX_QUEUE && selectedPositions.size === 0;
  const selectionEnabled = !filter;

  const handleRowClick = useCallback((e: React.MouseEvent, position: number) => {
    if (!selectionEnabled) {
      void playFromQueueIndex(position);
      return;
    }
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (isCtrl) {
      setSelectedPositions((prev) => {
        const next = new Set(prev);
        if (next.has(position)) next.delete(position);
        else next.add(position);
        return next;
      });
      lastClickedRef.current = position;
    } else if (isShift && lastClickedRef.current !== null) {
      const from = Math.min(lastClickedRef.current, position);
      const to = Math.max(lastClickedRef.current, position);
      setSelectedPositions((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(i);
        return next;
      });
    } else {
      setSelectedPositions(new Set());
      lastClickedRef.current = position;
      void playFromQueueIndex(position);
    }
  }, [selectionEnabled, playFromQueueIndex]);

  // Escape clears selection; Delete removes selected
  useEffect(() => {
    if (!isQueueOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedPositions.size > 0) {
        setSelectedPositions(new Set());
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedPositions.size > 0) {
        if (document.activeElement?.tagName === "INPUT") return;
        void removeManyFromQueue([...selectedPositions]);
        setSelectedPositions(new Set());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isQueueOpen, selectedPositions, removeManyFromQueue]);

  const virtualizer = useVirtualizer({
    count: visibleTracks.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => QUEUE_ROW_HEIGHT,
    overscan: 5,
  });

  if (!isQueueOpen) return null;

  const lastPosition = queue.length - 1;
  const virtualItems = virtualizer.getVirtualItems();

  function handleDragStart(e: React.DragEvent, position: number) {
    setDragFrom(position);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, position: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(position);
  }

  function handleDrop(e: React.DragEvent, position: number) {
    e.preventDefault();
    if (dragFrom !== null && dragFrom !== position) {
      moveQueueItem(dragFrom, position);
    }
    setDragFrom(null);
    setDropTarget(null);
  }

  function handleDragEnd() {
    setDragFrom(null);
    setDropTarget(null);
  }

  const selCount = selectedPositions.size;

  return (
    <div className="queue-panel" style={{ width: `${panelWidth}px` }}>
      <div className="queue-panel-resize-handle" onMouseDown={handleResizeMouseDown} />
      <div className="queue-panel-header">
        {selCount > 0 ? (
          <>
            <span className="queue-panel-title">{selCount} selected</span>
            <button
              className="queue-panel-close queue-deselect"
              onClick={() => setSelectedPositions(new Set())}
              aria-label="Clear selection"
            >
              <X size={16} />
            </button>
          </>
        ) : (
          <>
            <span className="queue-panel-title">Queue ({queue.length})</span>
            <RadioChip />
            <button className="queue-panel-close" onClick={toggleQueue} aria-label="Close queue">
              <X size={16} />
            </button>
          </>
        )}
      </div>
      <div className="queue-filter">
        <Search size={13} className="queue-filter-icon" aria-hidden />
        <input
          ref={filterInputRef}
          className="queue-filter-input"
          type="text"
          placeholder="Filter queue…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter queue"
        />
        {filter && (
          <button
            className="queue-filter-clear"
            onClick={() => { setFilter(""); filterInputRef.current?.focus(); }}
            aria-label="Clear filter"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="queue-list" ref={listRef}>
        {visibleTracks.length === 0 && (
          <p className="queue-empty">{filter ? "No matches" : "No tracks in queue"}</p>
        )}
        {visibleTracks.length > 0 && (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualItems.map((virtualItem) => {
              const { position, track } = visibleTracks[virtualItem.index]!;
              const artUrl = track.coverArtUrl
                ?? (track.artworkRef && serverWithCred
                  ? getCoverArtUrl(serverWithCred.server.url, serverWithCred.server.username, serverWithCred.credential, track.artworkRef, 64)
                  : null);
              const isSelected = selectedPositions.has(position);
              return (
                <div
                  key={`${track.id}-${position}`}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  className={[
                    "queue-row",
                    position === queueIndex ? "queue-row--active" : "",
                    dropTarget === position && dragFrom !== position ? "queue-row--drop-target" : "",
                    isSelected ? "queue-row--selected" : "",
                  ].filter(Boolean).join(" ")}
                  draggable={dndEnabled}
                  onDragStart={dndEnabled ? (e) => handleDragStart(e, position) : undefined}
                  onDragOver={dndEnabled ? (e) => handleDragOver(e, position) : undefined}
                  onDrop={dndEnabled ? (e) => handleDrop(e, position) : undefined}
                  onDragEnd={dndEnabled ? handleDragEnd : undefined}
                  onClick={(e) => handleRowClick(e, position)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, position });
                  }}
                >
                  <span className="queue-row-drag-handle" aria-hidden><GripVertical size={16} /></span>
                  <span className="queue-row-num">
                    {position === queueIndex ? <Play size={12} /> : position + 1}
                  </span>
                  {artUrl
                    ? <img src={artUrl} alt="" className="queue-row-art" />
                    : <div className="queue-row-art queue-row-art--placeholder" />}
                  <div className="queue-row-info">
                    <span className="queue-row-title">{track.title}</span>
                    {track.artist && <span className="queue-row-artist">{track.artist}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          {selCount > 1 ? (
            <button
              className="context-menu-danger"
              onClick={() => {
                void removeManyFromQueue([...selectedPositions]);
                setSelectedPositions(new Set());
                setContextMenu(null);
              }}
            >
              Remove {selCount} tracks
            </button>
          ) : (
            <>
              {contextMenu.position !== 0 && (
                <button
                  onClick={() => {
                    moveQueueItem(contextMenu.position, 0);
                    setContextMenu(null);
                  }}
                >
                  Move to Top
                </button>
              )}
              {contextMenu.position !== queueIndex + 1 && contextMenu.position !== queueIndex && (
                <button
                  onClick={() => {
                    moveQueueItem(contextMenu.position, queueIndex + 1);
                    setContextMenu(null);
                  }}
                >
                  Play Next
                </button>
              )}
              {contextMenu.position !== lastPosition && (
                <button
                  onClick={() => {
                    moveQueueItem(contextMenu.position, lastPosition);
                    setContextMenu(null);
                  }}
                >
                  Move to Bottom
                </button>
              )}
              <StartRadioSubmenu
                onSelect={(mode) => {
                  const entry = orderedTracks.find((t) => t.position === contextMenu.position);
                  if (entry) {
                    void playFromQueueIndex(contextMenu.position).then(() => {
                      startRadio(entry.track, mode);
                    });
                  }
                  setContextMenu(null);
                }}
              />
              <button
                className="context-menu-danger"
                onClick={() => {
                  void removeFromQueue(contextMenu.position);
                  setContextMenu(null);
                }}
              >
                Remove
              </button>
            </>
          )}
        </ContextMenu>
      )}
    </div>
  );
}
