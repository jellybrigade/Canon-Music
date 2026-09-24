import { useEffect, useState } from "react";
import "./SyncErrorBanner.css";

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

type Variant = "error" | "partial";

export function bannerMessage(
  variant: Variant,
  serverName: string,
  nextRetryAt: number | null,
  remaining: number,
): string {
  if (variant === "partial") return `Couldn't fully sync ${serverName}. Showing your saved library.`;
  if (nextRetryAt === null) return `Can't reach ${serverName}. Showing your saved library.`;
  if (remaining <= 0) return `Can't reach ${serverName}. Retrying now…`;
  return `Can't reach ${serverName}. Retrying in ${formatCountdown(remaining)}.`;
}

interface Props {
  variant: Variant;
  serverName: string;
  /** Raw failure text, shown only as a tooltip; Diagnostics renders it verbatim. */
  detail: string;
  nextRetryAt: number | null;
  onRetry: () => void;
}

export function SyncErrorBanner({ variant, serverName, detail, nextRetryAt, onRetry }: Props) {
  const [now, setNow] = useState(() => Date.now());

  // Owned here rather than in the library route so a ticking countdown re-renders
  // one span instead of the whole album grid.
  useEffect(() => {
    if (nextRetryAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(id); };
  }, [nextRetryAt]);

  const remaining = nextRetryAt === null ? 0 : nextRetryAt - now;
  const counting = nextRetryAt !== null && remaining > 0;

  return (
    <span className="sync-status sync-status--error" title={detail || undefined}>
      {bannerMessage(variant, serverName, nextRetryAt, remaining)}
      <button className="sync-retry-btn" onClick={onRetry}>
        {counting ? "Retry now" : "Retry"}
      </button>
    </span>
  );
}
