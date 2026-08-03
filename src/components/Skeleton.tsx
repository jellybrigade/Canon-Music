import type { CSSProperties } from "react";
import "./Skeleton.css";

// Shared loading-skeleton primitives. Before this existed every view that wanted one
// hand-rolled its own bars (AlbumDetail.css, NowPlayingView.css, TrackTableView) and the
// views that did not want to hand-roll a third copy shipped a bare "Loading…" line
// instead. All of these share the `canon-skeleton-pulse` keyframe in App.css, which the
// app-wide prefers-reduced-motion rule there already freezes.
//
// A skeleton is only worth rendering if it matches the layout it stands in for, so the
// geometry is passed in by the caller rather than guessed here: `minWidth` and `gap` come
// from the same constants the real grid's virtualizer uses, handed to CSS through custom
// properties so there is one writer for the number instead of a copy that can drift.

interface BarProps {
  /** Any CSS width. Percentages read best in a list, so they are the common case. */
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
}

export function SkeletonBar({ width = "100%", height = "var(--text-base)", radius, className }: BarProps) {
  return (
    <span
      className={className ? `skeleton-bar ${className}` : "skeleton-bar"}
      style={{ width, height, ...(radius ? { borderRadius: radius } : null) }}
    />
  );
}

interface CardGridProps {
  count?: number;
  /** Matches the real grid's CARD_MIN so the placeholder resolves to the same column count. */
  minWidth?: number;
  gap?: number;
  padding?: number;
  /** Artist cards are circular; album and playlist cards are square. */
  round?: boolean;
  /** Playlist cards put their text under the art rather than over it. */
  captioned?: boolean;
  label?: string;
}

export function CardGridSkeleton({
  count = 12,
  minWidth = 190,
  gap = 16,
  padding = 20,
  round = false,
  captioned = false,
  label = "Loading",
}: CardGridProps) {
  return (
    <div
      className="skeleton-card-grid"
      style={
        {
          "--skeleton-card-min": `${minWidth}px`,
          "--skeleton-card-gap": `${gap}px`,
          "--skeleton-card-pad": `${padding}px`,
        } as CSSProperties
      }
      aria-label={label}
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-card">
          <span className={round ? "skeleton-card-art skeleton-card-art--round" : "skeleton-card-art"} />
          {captioned && (
            <div className="skeleton-card-caption">
              <SkeletonBar width="70%" />
              <SkeletonBar width="45%" height="var(--text-sm)" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface RowListProps {
  count?: number;
  label?: string;
}

/** Stand-in for a plain list of rows (playlist tracks, and anything else row-shaped). */
export function RowListSkeleton({ count = 10, label = "Loading" }: RowListProps) {
  return (
    <div className="skeleton-row-list" aria-label={label} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-row">
          <SkeletonBar width="1.5rem" />
          <SkeletonBar width={`${45 + ((i * 7) % 35)}%`} />
          <SkeletonBar width="2.5rem" />
        </div>
      ))}
    </div>
  );
}
