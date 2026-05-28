import { useEffect, useRef, useState } from "react";
import { X, GripVertical, Play } from "lucide-react";
import { usePlayerStore } from "../store/player";
import "./QueuePanel.css";

type ContextMenu = { x: number; y: number; position: number } | null;

export function QueuePanel() {
  const {
    queue,
    queueIndex,
    isShuffled,
    shuffleOrder,
    isQueueOpen,
    toggleQueue,
    removeFromQueue,
    moveQueueItem,
  } = usePlayerStore();

  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function onClickOutside(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  if (!isQueueOpen) return null;

  const orderedTracks = Array.from({ length: queue.length }, (_, i) => {
    const idx = isShuffled && shuffleOrder.length > 0 ? (shuffleOrder[i] ?? i) : i;
    return { position: i, track: queue[idx]! };
  });

  const lastPosition = queue.length - 1;

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

  return (
    <div className="queue-panel">
      <div className="queue-panel-header">
        <span className="queue-panel-title">Queue ({queue.length})</span>
        <button className="queue-panel-close" onClick={toggleQueue} aria-label="Close queue">
          <X size={14} />
        </button>
      </div>
      <div className="queue-list">
        {orderedTracks.length === 0 && (
          <p className="queue-empty">No tracks in queue</p>
        )}
        {orderedTracks.map(({ position, track }) => (
          <div
            key={`${track.id}-${position}`}
            className={[
              "queue-row",
              position === queueIndex ? "queue-row--active" : "",
              dropTarget === position && dragFrom !== position ? "queue-row--drop-target" : "",
            ].filter(Boolean).join(" ")}
            draggable
            onDragStart={(e) => handleDragStart(e, position)}
            onDragOver={(e) => handleDragOver(e, position)}
            onDrop={(e) => handleDrop(e, position)}
            onDragEnd={handleDragEnd}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, position });
            }}
          >
            <span className="queue-row-drag-handle" aria-hidden><GripVertical size={14} /></span>
            <span className="queue-row-indicator">
              {position === queueIndex ? <Play size={10} /> : ""}
            </span>
            <span className="queue-row-num">{position + 1}</span>
            <div className="queue-row-info">
              <span className="queue-row-title">{track.title}</span>
              {track.artist && <span className="queue-row-artist">{track.artist}</span>}
            </div>
          </div>
        ))}
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
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
          <button
            className="context-menu-danger"
            onClick={() => {
              void removeFromQueue(contextMenu.position);
              setContextMenu(null);
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
