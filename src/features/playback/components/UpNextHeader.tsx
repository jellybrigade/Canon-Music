import { useMemo, useState } from "react";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { plural } from "../../../lib/plural";
import { formatTotalDuration } from "../../../lib/trackCells";
import { usePlayerStore } from "../store/player";
import { SaveQueueForm } from "./SaveQueueForm";
import "./UpNextHeader.css";

interface Props {
  serverWithCredential: ServerWithCredential;
}

export function UpNextHeader({ serverWithCredential }: Props) {
  const queue = usePlayerStore((s) => s.queue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const [isSaving, setIsSaving] = useState(false);
  const totalSeconds = useMemo(() => queue.reduce((sum, track) => sum + (track.duration ?? 0), 0), [queue]);

  if (queue.length === 0) return null;

  if (isSaving) {
    return (
      <div className="up-next-header">
        <SaveQueueForm serverWithCredential={serverWithCredential} onDone={() => setIsSaving(false)} />
      </div>
    );
  }

  return (
    <div className="up-next-header up-next-header--summary">
      <span className="up-next-header-summary">
        {queue.length} {plural(queue.length, "track")} · {formatTotalDuration(totalSeconds)}
      </span>
      <div className="up-next-header-actions">
        <button
          type="button"
          className="up-next-header-btn"
          title="Save the queue as a Navidrome playlist"
          onClick={() => setIsSaving(true)}
        >
          Save as playlist
        </button>
        <button
          type="button"
          className="up-next-header-btn up-next-header-btn--quiet"
          title="Clear the queue"
          onClick={() => clearQueue()}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
