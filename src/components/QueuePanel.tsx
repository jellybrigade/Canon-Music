import { useState } from "react";
import { X, GripVertical, Play } from "lucide-react";
import { usePlayerStore } from "../store/player";
import { getCoverArtUrl } from "../lib/navidrome";
import { ContextMenu } from "./ContextMenu";
import { RadioChip } from "./RadioChip";
import type { ServerWithCredential } from "../hooks/useServer";
import "./QueuePanel.css";

type ContextMenu = { x: number; y: number; position: number } | null;

interface QueuePanelProps {
  serverWithCred?: ServerWithCredential;
}

export function QueuePanel({ serverWithCred }: QueuePanelProps) {
  const queue          = usePlayerStore((s) => s.queue);
  const queueIndex     = usePlayerStore((s) => s.queueIndex);
  const isShuffled     = usePlayerStore((s) => s.isShuffled);
  const shuffleOrder   = usePlayerStore((s) => s.shuffleOrder);
  const isQueueOpen    = usePlayerStore((s) => s.isQueueOpen);
  const toggleQueue    = usePlayerStore((s) => s.toggleQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const moveQueueItem  = usePlayerStore((s) => s.moveQueueItem);

  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

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
        <RadioChip />
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
            {(() => {
              const artUrl = track.coverArtUrl
                ?? (track.artworkRef && serverWithCred
                  ? getCoverArtUrl(serverWithCred.server.url, serverWithCred.server.username, serverWithCred.credential, track.artworkRef, 64)
                  : null);
              return artUrl
                ? <img src={artUrl} alt="" className="queue-row-art" />
                : <div className="queue-row-art queue-row-art--placeholder" />;
            })()}
            <div className="queue-row-info">
              <span className="queue-row-title">{track.title}</span>
              {track.artist && <span className="queue-row-artist">{track.artist}</span>}
            </div>
          </div>
        ))}
      </div>

      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
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
        </ContextMenu>
      )}
    </div>
  );
}
