import { useState } from "react";
import { createPortal } from "react-dom";
import { getCoverArtUrl, ORIGINAL_COVER_SIZE } from "../../clients/navidromeUrls";
import type { ServerWithCredential } from "../../hooks/useServer";
import { errorMessage } from "../../lib/errorMessage";
import type { AlbumRow } from "../../types/library";
import { SkeletonBar } from "../../ui/Skeleton";
import { useModalChrome } from "../../ui/useModalChrome";
import { useOverlayDismiss } from "../../ui/useOverlayDismiss";
import type { CoverChoice } from "./albumCoverOverrides";
import { COVER_SOURCE_LABELS, type CoverCandidate, isCoverSource, rankCoverCandidates } from "./coverCandidates";
import { useAlbumCoverOverride, useCoverCandidates, useSetAlbumCover } from "./useAlbumCover";
import "../enrichment/components/IdentifyDialog.css";
import "./CoverPickerDialog.css";
import { CoverImg } from "../../components/CoverImg";

const SKELETON_TILES = 6;

interface Dimensions {
  width: number;
  height: number;
}

function formatSize({ width, height }: Dimensions): string {
  return `${width} × ${height}`;
}

function formatCaption(candidate: CoverCandidate, size: Dimensions | null): string {
  if (size) return formatSize(size);
  return candidate.maxEdge === null ? "\u00a0" : `up to ${candidate.maxEdge} px`;
}

/** "from Cover Art Archive (1200 × 1200)", as much of it as the stored choice knows. */
function describeChoice(choice: CoverChoice): string {
  const source = isCoverSource(choice.source) ? ` from ${COVER_SOURCE_LABELS[choice.source]}` : "";
  const size =
    choice.width !== null && choice.height !== null
      ? ` (${formatSize({ width: choice.width, height: choice.height })})`
      : "";
  return `${source}${size}`;
}

function noCoversMessage(wereAllBroken: boolean, didAnySourceFail: boolean): string {
  if (wereAllBroken) return "The covers found online could not be loaded.";
  if (didAnySourceFail) return "No covers came back from the sources that answered.";
  return "No covers found online for this album.";
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
      <CoverImg
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

/** "Cover Art Archive 2, up to 1200 px, in use": the tile's caption alone repeats across a source. */
function tileLabel(candidate: CoverCandidate, position: number, size: Dimensions | null, isCurrent: boolean): string {
  const caption = formatCaption(candidate, size).trim();
  return [`${COVER_SOURCE_LABELS[candidate.source]} ${position}`, caption, isCurrent ? "in use" : ""]
    .filter(Boolean)
    .join(", ");
}

function CandidateTile({
  candidate,
  position,
  size,
  isSelected,
  isCurrent,
  isDisabled,
  onSelect,
  onBroken,
}: {
  candidate: CoverCandidate;
  /** 1-based, among the tiles of the same source. */
  position: number;
  size: Dimensions | null;
  isSelected: boolean;
  isCurrent: boolean;
  isDisabled: boolean;
  onSelect: () => void;
  onBroken: () => void;
}) {
  return (
    <button
      type="button"
      className={`cover-picker-tile${isSelected ? " cover-picker-tile--selected" : ""}`}
      aria-pressed={isSelected}
      aria-label={tileLabel(candidate, position, size, isCurrent)}
      disabled={isDisabled}
      onClick={onSelect}
    >
      <CoverImg
        className="cover-picker-tile-art"
        src={candidate.thumbUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={onBroken}
      />
      <span className="cover-picker-tile-caption">
        <span className="cover-picker-tile-source">{COVER_SOURCE_LABELS[candidate.source]}</span>
        {isCurrent ? (
          <span className="cover-picker-tile-current">In use</span>
        ) : (
          <span className="cover-picker-tile-size">{formatCaption(candidate, size)}</span>
        )}
      </span>
    </button>
  );
}

export function CoverPickerDialog({ album, serverWithCredential, onClose, onIdentify }: Props) {
  const candidates = useCoverCandidates(album);
  const override = useAlbumCoverOverride(album);
  const setCover = useSetAlbumCover(album, serverWithCredential);
  const dismiss = useOverlayDismiss(onClose, { closable: !setCover.isPending });
  const chrome = useModalChrome(onClose, { closable: !setCover.isPending });
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  // Keyed by image URL, so a size never outlives the image it was read from.
  const [measuredSizes, setMeasuredSizes] = useState<Partial<Record<string, Dimensions>>>({});
  const measure = (src: string, size: Dimensions) => setMeasuredSizes((sizes) => ({ ...sizes, [src]: size }));
  // A tile whose image never loads can't be judged, so it isn't offered.
  const [brokenThumbs, setBrokenThumbs] = useState<Partial<Record<string, true>>>({});

  const results = candidates.data ?? [];
  const found = rankCoverCandidates(results);
  const ranked = found.filter((candidate) => !brokenThumbs[candidate.thumbUrl]);
  const selected = ranked.find((candidate) => candidate.fullUrl === selectedUrl) ?? null;
  const isSelectedInUse = selected !== null && selected.fullUrl === override.data?.fullUrl;
  const unanswered = results.filter((result) => result.status !== "found");
  const needsIdentity = results.some(
    (result) =>
      result.status === "skipped" && (result.source === "caa-release" || result.source === "caa-release-group"),
  );
  const { server, credential } = serverWithCredential;
  const currentUrl = album.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, ORIGINAL_COVER_SIZE)
    : null;
  const hasOverride = override.isSuccess && override.data !== null;

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
            {override.error ? (
              <p className="identify-hint identify-hint--error">
                Could not read which cover is in use: {errorMessage(override.error)}
              </p>
            ) : (
              override.isSuccess && (
                <p className="identify-hint">
                  {override.data
                    ? `Showing a cover you picked${describeChoice(override.data)}. Canon keeps it to itself; the server and your files still have their own.`
                    : "Showing the server's cover. A cover you pick stays in Canon; the server and your files keep theirs."}
                </p>
              )
            )}
          </div>

          {candidates.isPending ? (
            <div className="cover-picker-grid" role="status" aria-busy="true" aria-label="Searching for covers">
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
            <div className="cover-picker-grid" role="group" aria-label="Covers found">
              {ranked.map((candidate, index) => (
                <CandidateTile
                  key={candidate.fullUrl}
                  candidate={candidate}
                  position={ranked.slice(0, index + 1).filter((other) => other.source === candidate.source).length}
                  size={knownSize(candidate, measuredSizes[candidate.fullUrl])}
                  isSelected={candidate.fullUrl === selectedUrl}
                  isCurrent={candidate.fullUrl === override.data?.fullUrl}
                  isDisabled={setCover.isPending}
                  onSelect={() => setSelectedUrl(candidate.fullUrl)}
                  onBroken={() => setBrokenThumbs((broken) => ({ ...broken, [candidate.thumbUrl]: true }))}
                />
              ))}
            </div>
          ) : (
            <p className="identify-hint">
              {noCoversMessage(
                found.length > 0,
                unanswered.some((result) => result.status === "failed"),
              )}
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
            disabled={selected === null || isSelectedInUse || setCover.isPending}
          >
            {setCover.isPending ? "Saving…" : "Use this cover"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
