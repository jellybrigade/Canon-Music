import type { PlaybackErrorCause } from "../store/playerTypes";

interface Props {
  cause: PlaybackErrorCause | null;
  onRetry: () => void;
  onSkip: () => void;
  skipDisabled: boolean;
  onOpenResync: () => void;
}

/** Shared by the player bar and now-playing view so they can't drift apart. A stale
 * track id can't be fixed here since the ids the mirror was built from are gone. */
export function PlaybackErrorActions({ cause, onRetry, onSkip, skipDisabled, onOpenResync }: Props) {
  return (
    <>
      <button className="player-error-action" onClick={onRetry}>Retry</button>
      <button className="player-error-action" onClick={onSkip} disabled={skipDisabled}>Skip</button>
      {cause === "stale-track-id" && (
        <button className="player-error-action" onClick={onOpenResync}>Resync library</button>
      )}
    </>
  );
}
