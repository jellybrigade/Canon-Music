import { useState } from "react";
import { createPortal } from "react-dom";
import { getCoverArtUrl, ORIGINAL_COVER_SIZE } from "../../clients/navidromeUrls";
import type { ServerWithCredential } from "../../hooks/useServer";
import { errorMessage } from "../../lib/errorMessage";
import type { AlbumRow } from "../../types/library";
import { SkeletonBar } from "../../ui/Skeleton";
import { useModalChrome } from "../../ui/useModalChrome";
import { useOverlayDismiss } from "../../ui/useOverlayDismiss";
import { COVER_SOURCE_LABELS, type CoverCandidate, rankCoverCandidates } from "./coverCandidates";
import { useAlbumCoverOverride, useCoverCandidates, useSetAlbumCover } from "./useAlbumCover";
import "../enrichment/components/IdentifyDialog.css";
import "./CoverPickerDialog.css";

const SKELETON_TILES = 6;

interface Dimensions {
  width: number;
  height: number;
}

function formatSize({ width, height }: Dimensions): string {
  return `${width} × ${height}`;
}

/** What the full image measured once loaded, else the size its source claims. */
function knownSize(candidate: CoverCandidate, measured: Dimensions | undefined): Dimensions | null {
  if (measured) return measured;
  return candidate.width !== null && candidate.height !== null
    ? { width: candidate.width, height: candidate.height }
    : null;
}

interface Props {
  album: AlbumRow;
  serverWithCredential: ServerWithCredential;
  onClose: () => void;
  /** Offered when the album has no MusicBrainz identity, which two of the sources need. */
  onIdentify?: () => void;
}

/** Shows `src` small and reports its real pixel size, which only the loaded image knows. */
function CoverPreview({
  label,
  src,
  size,
  onMeasure,
}: {
  label: string;
  src: string;
  size: Dimensions | null;
  onMeasure: (src: string, size: Dimensions) => void;
}) {
  return (
    <figure className="cover-picker-preview">
      <img
        className="cover-picker-preview-art"
        src={src}
        alt=""
        decoding="async"
        onLoad={(event) =>
          onMeasure(src, { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
        }
      />
      <figcaption className="cover-picker-preview-caption">
        <span>{label}</span>
        <span className="cover-picker-preview-size">{size ? formatSize(size) : "\u00a0"}</span>
      </figcaption>
    </figure>
  );
}

function CandidateTile({
  candidate,
  size,
  isSelected,
  isCurrent,
  onSelect,
}: {
  candidate: CoverCandidate;
  size: Dimensions | null;
  isSelected: boolean;
  isCurrent: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`cover-picker-tile${isSelected ? " cover-picker-tile--selected" : ""}`}
      aria-pressed={isSelected}
      onClick={onSelect}
    >
      <img className="cover-picker-tile-art" src={candidate.thumbUrl} alt="" loading="lazy" decoding="async" />
      <span className="cover-picker-tile-caption">
        <span>{COVER_SOURCE_LABELS[candidate.source]}</span>
        {isCurrent ? (
          <span className="cover-picker-tile-current">In use</span>
        ) : (
          size && <span>{formatSize(size)}</span>
        )}
      </span>
    </button>
  );
}

export function CoverPickerDialog({ album, serverWithCredential, onClose, onIdentify }: Props) {
  const candidates = useCoverCandidates(album);
  const override = useAlbumCoverOverride(album);
  const setCover = useSetAlbumCover(album, serverWithCredential);
  const dismiss = useOverlayDismiss(onClose);
  const chrome = useModalChrome(onClose, { closable: !setCover.isPending });
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  // Keyed by image URL, so a size never outlives the image it was read from.
  const [measuredSizes, setMeasuredSizes] = useState<Partial<Record<string, Dimensions>>>({});
  const measure = (src: string, size: Dimensions) => setMeasuredSizes((sizes) => ({ ...sizes, [src]: size }));

  const results = candidates.data ?? [];
  const ranked = rankCoverCandidates(results);
  const selected = ranked.find((candidate) => candidate.fullUrl === selectedUrl) ?? null;
  const unanswered = results.filter((result) => result.status !== "found");
  const needsIdentity = results.some(
    (result) =>
      result.status === "skipped" && (result.source === "caa-release" || result.source === "caa-release-group"),
  );
  const { server, credential } = serverWithCredential;
  const currentUrl = album.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, ORIGINAL_COVER_SIZE)
    : null;
  const hasOverride = Boolean(override.data);

  const choose = (choice: CoverCandidate | null) => {
    const size = choice && knownSize(choice, measuredSizes[choice.fullUrl]);
    setCover.mutate(choice && size ? { ...choice, ...size } : choice, { onSuccess: onClose });
  };

  return createPortal(
    <div className="identify-overlay" {...dismiss}>
      <div className="identify-dialog cover-picker-dialog" {...chrome} aria-label="Choose cover">
        <div className="identify-header">
          <h2 className="identify-title">Choose Cover</h2>
          <button className="identify-close" onClick={onClose} aria-label="Close" disabled={setCover.isPending}>
            ✕
          </button>
        </div>

        <div className="identify-body">
          <div className="cover-picker-current">
            {currentUrl && (
              <CoverPreview
                label="Current"
                src={currentUrl}
                size={measuredSizes[currentUrl] ?? null}
                onMeasure={measure}
              />
            )}
            {selected && (
              <CoverPreview
                label="New"
                src={selected.fullUrl}
                size={knownSize(selected, measuredSizes[selected.fullUrl])}
                onMeasure={measure}
              />
            )}
            <p className="identify-hint">
              {hasOverride
                ? "Showing a cover you picked. Canon keeps it to itself; the server and your files still have their own."
                : "Showing the server's cover. A cover you pick stays in Canon; the server and your files keep theirs."}
            </p>
          </div>

          {candidates.isPending ? (
            <div className="cover-picker-grid" aria-label="Searching for covers">
              {Array.from({ length: SKELETON_TILES }, (_, index) => (
                <SkeletonBar key={index} className="cover-picker-tile-skeleton" height="auto" />
              ))}
            </div>
          ) : candidates.error ? (
            <p className="identify-hint identify-hint--error">
              Could not search for covers: {errorMessage(candidates.error)}{" "}
              <button className="cover-picker-link" onClick={() => void candidates.refetch()}>
                Try again
              </button>
            </p>
          ) : ranked.length > 0 ? (
            <div className="cover-picker-grid">
              {ranked.map((candidate) => (
                <CandidateTile
                  key={candidate.fullUrl}
                  candidate={candidate}
                  size={knownSize(candidate, measuredSizes[candidate.fullUrl])}
                  isSelected={candidate.fullUrl === selectedUrl}
                  isCurrent={candidate.fullUrl === override.data?.fullUrl}
                  onSelect={() => setSelectedUrl(candidate.fullUrl)}
                />
              ))}
            </div>
          ) : (
            <p className="identify-hint">
              {unanswered.some((result) => result.status === "failed")
                ? "No covers came back from the sources that answered."
                : "No covers found online for this album."}
            </p>
          )}

          {unanswered.length > 0 && (
            <ul className="cover-picker-sources">
              {unanswered.map((result) => (
                <li
                  key={result.source}
                  className={`identify-hint${result.status === "failed" ? " identify-hint--error" : ""}`}
                >
                  {COVER_SOURCE_LABELS[result.source]}: {result.status === "failed" ? "couldn't search, " : ""}
                  {result.reason}
                </li>
              ))}
              {candidates.data && unanswered.some((result) => result.status === "failed") && (
                <li>
                  <button className="cover-picker-link" onClick={() => void candidates.refetch()}>
                    Search again
                  </button>
                </li>
              )}
            </ul>
          )}
          {needsIdentity && onIdentify && (
            <button className="cover-picker-link" onClick={onIdentify}>
              Identify on MusicBrainz…
            </button>
          )}
        </div>

        <div className="identify-footer">
          {setCover.error && (
            <p className="identify-hint identify-hint--error cover-picker-footer-error" role="alert">
              {errorMessage(setCover.error)}
            </p>
          )}
          {hasOverride && (
            <button
              className="identify-btn cover-picker-revert"
              onClick={() => choose(null)}
              disabled={setCover.isPending}
            >
              Use server cover
            </button>
          )}
          <button className="identify-btn" onClick={onClose} disabled={setCover.isPending}>
            Cancel
          </button>
          <button
            className="identify-btn identify-btn--primary"
            onClick={() => {
              if (selected) choose(selected);
            }}
            disabled={selected === null || setCover.isPending}
          >
            {setCover.isPending ? "Saving…" : "Use this cover"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
