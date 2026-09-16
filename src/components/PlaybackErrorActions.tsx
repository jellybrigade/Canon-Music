import type { PlaybackErrorCause } from "../store/player";

interface Props {
  cause: PlaybackErrorCause | null;
  onRetry: () => void;
  onSkip: () => void;
  skipDisabled: boolean;
  onOpenResync: () => void;
}

/**
 * The actions offered beside a playback error, shared by the player bar and the now-playing
 * view so the two cannot drift apart. Retry and Skip always apply; a stale track id is the
 * one failure the user cannot resolve from here, because the ids the whole mirror was built
 * from are gone, so it points at the resync that reads them again.
 */
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
