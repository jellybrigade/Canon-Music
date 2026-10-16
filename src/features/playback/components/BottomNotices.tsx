import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { AlbumTracksNotice } from "../../../components/AlbumTracksNotice";
import { useSetting } from "../../../hooks/useSetting";
import { useAlbumTracksNoticeStore } from "../../../store/albumTracksNotice";
import { ContextMenu } from "../../../ui/ContextMenu";
import { runEnrichment } from "../../tags/hooks/useBackgroundNormalizer";
import { useTagsStore } from "../../tags/store/tags";
import { usePlayerStore } from "../store/player";
import { isNextDisabled } from "../store/playerTypes";
import { PlaybackErrorActions } from "./PlaybackErrorActions";
import "./BottomNotices.css";

const SNOOZE_OPTIONS: [label: string, seconds: number | null][] = [
  ["Snooze 1 day", 86400],
  ["Snooze 1 week", 604800],
  ["Snooze 1 month", 2592000],
  ["Never show again", null],
];

function EnrichmentPendingNotice({ count }: { count: number }) {
  const setEnrichmentPending = useTagsStore((s) => s.setEnrichmentPending);
  const [, setSnoozeUntil] = useSetting("enrichment.snooze_until", "");
  const [snoozeMenu, setSnoozeMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <div className="normalizing-bar">
      Metadata not fetched for {count} albums
      <button
        className="normalizing-bar__action"
        onClick={() => {
          void runEnrichment();
        }}
      >
        Fetch now
      </button>
      <button className="normalizing-bar__dismiss" onClick={() => setEnrichmentPending(null)}>
        Dismiss
      </button>
      <button
        className="normalizing-bar__more"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setSnoozeMenu({ x: r.left, y: r.bottom });
        }}
      >
        …
      </button>
      {snoozeMenu && (
        <ContextMenu x={snoozeMenu.x} y={snoozeMenu.y} onClose={() => setSnoozeMenu(null)}>
          {SNOOZE_OPTIONS.map(([label, seconds]) => (
            <button
              key={label}
              onClick={() => {
                void setSnoozeUntil(seconds === null ? "forever" : String(Math.floor(Date.now() / 1000) + seconds));
                setEnrichmentPending(null);
                setSnoozeMenu(null);
              }}
            >
              {label}
            </button>
          ))}
        </ContextMenu>
      )}
    </div>
  );
}

function PlaybackErrorNotice({ onOpenResync }: { onOpenResync: () => void }) {
  const error = usePlayerStore((s) => s.error);
  const retryCurrent = usePlayerStore((s) => s.retryCurrent);
  const next = usePlayerStore((s) => s.next);
  const nextDisabled = usePlayerStore((s) => isNextDisabled(s.repeat, s.queueIndex, s.queue.length, s.radioOnQueueEnd));
  if (!error) return null;
  return (
    <div className="normalizing-bar playback-error-bar" role="alert">
      <AlertCircle size={13} className="playback-error-bar__icon" aria-hidden="true" />
      <span className="playback-error-bar__message" title={error.message}>
        {error.message}
      </span>
      <PlaybackErrorActions
        cause={error.cause}
        onRetry={retryCurrent}
        onSkip={() => void next()}
        skipDisabled={nextDisabled}
        onOpenResync={onOpenResync}
      />
    </div>
  );
}

/** One stack, so the rows can't overlap and the space pages reserve is counted once. At most one
 * info row, in this order of precedence, plus the playback error nearest the player. */
export function BottomNotices({ onOpenResync }: { onOpenResync: () => void }) {
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  const hasError = usePlayerStore((s) => s.error !== null);
  const albumTracksNotice = useAlbumTracksNoticeStore((s) => s.notice);
  const pullProgress = useTagsStore((s) => s.pullProgress);
  const enrichmentPending = useTagsStore((s) => s.enrichmentPending);

  const hasInfoRow = albumTracksNotice !== null || pullProgress !== null || Boolean(enrichmentPending);
  const showsError = hasTrack && hasError;
  const rowCount = Number(hasInfoRow) + Number(showsError);

  useEffect(() => {
    document.documentElement.style.setProperty("--bottom-notice-rows", String(rowCount));
    // Unmounts with the player bar (Now Playing); a stale count would reserve an empty strip.
    return () => document.documentElement.style.setProperty("--bottom-notice-rows", "0");
  }, [rowCount]);

  if (rowCount === 0) return null;
  return (
    <div className={`bottom-notices${hasTrack ? " bottom-notices--above-player" : ""}`}>
      {albumTracksNotice ? (
        <AlbumTracksNotice />
      ) : pullProgress ? (
        <div className="normalizing-bar">
          Fetching metadata… {pullProgress.done} / {pullProgress.total}
        </div>
      ) : enrichmentPending ? (
        <EnrichmentPendingNotice count={enrichmentPending} />
      ) : null}
      {showsError && <PlaybackErrorNotice onOpenResync={onOpenResync} />}
    </div>
  );
}
