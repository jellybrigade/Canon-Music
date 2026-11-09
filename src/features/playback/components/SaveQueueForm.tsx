import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { errorMessage } from "../../../lib/errorMessage";
import { createPlaylist } from "../../playlists/usePlaylists";
import { defaultQueuePlaylistName } from "../lib/queuePlaylistName";
import { usePlayerStore } from "../store/player";
import { queueInPlayOrder } from "../store/queueOrder";
import "./SaveQueueForm.css";

interface Props {
  serverWithCredential: ServerWithCredential;
  onDone: () => void;
}

export function SaveQueueForm({ serverWithCredential, onDone }: Props) {
  const isQueueEmpty = usePlayerStore((s) => s.queue.length === 0);
  const [name, setName] = useState(() => {
    const { radioActive, radioSeed } = usePlayerStore.getState();
    return defaultQueuePlaylistName(radioActive ? radioSeed : null, new Date());
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isSaving) return;
    // Read at submit so a track that started or a reshuffle since opening is what gets saved.
    const { queue, isShuffled, shuffleOrder } = usePlayerStore.getState();
    if (queue.length === 0) return;
    const trackIds = queueInPlayOrder(queue, isShuffled, shuffleOrder).map((row) => row.track.id);
    setIsSaving(true);
    setSaveError(null);
    try {
      await createPlaylist(trimmed, serverWithCredential, trackIds);
      onDone();
    } catch (err) {
      setSaveError(errorMessage(err));
      setIsSaving(false);
    }
  }

  return (
    <form className="save-queue-form" onSubmit={handleSubmit}>
      <div className="save-queue-form-row">
        <input
          ref={inputRef}
          type="text"
          className="save-queue-form-input"
          aria-label="Playlist name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !isSaving) {
              e.preventDefault();
              onDone();
            }
          }}
        />
        <button type="submit" disabled={isQueueEmpty || !name.trim() || isSaving}>
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={isSaving} onClick={onDone}>
          Cancel
        </button>
      </div>
      {saveError && (
        <p className="save-queue-form-error" role="alert">
          Couldn't save the playlist: {saveError}
        </p>
      )}
    </form>
  );
}
