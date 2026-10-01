import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ArtistRow } from "../types/library";
import type { ServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl, getArtistImageUrl } from "../clients/navidromeUrls";
import { resolvePortraitUrl } from "../clients/lastfm";
import { useArtistImageMap } from "../hooks/useArtistImageCache";
import { useEnrichArtist } from "../features/enrichment/hooks/useEnrichArtist";
import { useScrollMemory } from "../hooks/useScrollMemory";
import { useMeasuredElement } from "../hooks/useMeasuredElement";
import { ContextMenu } from "../ui/ContextMenu";
import { StartRadioSubmenu } from "../features/radio/components/StartRadioSubmenu";
import { ArtistIdentifyDialog } from "../features/enrichment/components/IdentifyDialog";
import { CardGridSkeleton } from "../ui/Skeleton";
import type { RadioMode } from "../features/playback/store/playerTypes";
import { useSetting } from "../hooks/useSetting";

/** Lazily triggers portrait enrichment once a grid tile scrolls into view, so artists
 * never opened individually still get one. A null component, not a card hook, so the
 * grid can skip mounting it for artists whose enrichment is already fresh. */
function LazyPortraitEnrich({ artistName, serverWithCredential, elRef }: {
  artistName: string;
  serverWithCredential: ServerWithCredential;
  elRef: RefObject<HTMLElement | null>;
}) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (inView) return;
    const el = elRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) setInView(true); },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, elRef]);
  useEnrichArtist(artistName, { enabled: inView, serverWithCredential });
  return null;
}

const PADDING = 20;
const COL_GAP = 16;
const ROW_GAP = 24;
const CARD_MIN = 190;

interface Props {
  artists: ArtistRow[];
  serverWithCredential: ServerWithCredential;
  onSelect: (artist: ArtistRow) => void;
  onStartRadio?: (artist: ArtistRow, mode: RadioMode) => void;
  /** True only while there is nothing to show yet - a refresh over existing rows keeps them. */
  isLoading?: boolean;
  /** Set when the read failed. Without it a failure renders as an empty library. */
  error?: string | null;
  onRetry?: () => void;
}

export function ArtistGrid({ artists, serverWithCredential, onSelect, onStartRadio, isLoading = false, error = null, onRetry }: Props) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; artist: ArtistRow } | null>(null);
  const [identifyArtist, setIdentifyArtist] = useState<ArtistRow | null>(null);
  const [failedPortraits, setFailedPortraits] = useState<Set<string>>(new Set());
  const artistImageMap = useArtistImageMap();

  // Artist-agnostic handlers so their references never change and don't defeat
  // ArtistGridCard's React.memo; empty deps are correct since the setters are stable.
  const handleContextMenu = useCallback((e: MouseEvent, artist: ArtistRow) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, artist });
  }, []);
  const handlePortraitError = useCallback((artistName: string) => {
    setFailedPortraits((prev) => new Set(prev).add(artistName));
  }, []);

  // Same staleness rule as useEnrichArtist's isEnrichmentStale, computed here from
  // the enriched_at already joined into get_artists, so fresh artists (the common
  // case) never mount the per-card enrichment query at all.
  const [staleDaysStr] = useSetting("tags.staleness_days", "30");
  const staleDays = Number(staleDaysStr) || 30;
  const staleCutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  // The scroller below is rendered only once there are artists, so it has to be measured on
  // attach rather than from an effect - see useMeasuredElement.
  const { ref: containerRef, attach: attachContainer, width: containerWidth } =
    useMeasuredElement<HTMLDivElement>();

  const available = containerWidth > 0 ? containerWidth - PADDING * 2 : 0;
  const cols = Math.max(1, Math.floor((available + COL_GAP) / (CARD_MIN + COL_GAP)));
  const cardWidth = available > 0 ? (available - COL_GAP * (cols - 1)) / cols : CARD_MIN;
  const rowHeight = Math.round(cardWidth) + ROW_GAP;
  const rowCount = Math.ceil(artists.length / cols);

  // Padding declared to the virtualizer, not added to each row's `top` by hand, so its
  // offsets stay in the same coordinate space as the rows painted (see known-issues).
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
    paddingStart: PADDING,
    paddingEnd: PADDING,
  });

  useScrollMemory(containerRef, "artists", rowCount > 0);

  const prevLayoutKey = useRef(`${cols}-${rowHeight}`);
  useLayoutEffect(() => {
    const key = `${cols}-${rowHeight}`;
    if (prevLayoutKey.current !== key) {
      prevLayoutKey.current = key;
      virtualizer.measure();
    }
  }, [cols, rowHeight, virtualizer]);

  // Check error before loading: a failed read leaves data undefined, so `isLoading` stays
  // true and a skeleton would pulse forever; falling through to the sync-advice empty state hid the failure entirely.
  if (artists.length === 0 && error) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Couldn't load your artists</p>
        <p className="empty-state-hint">{error}</p>
        {onRetry && <button className="empty-state-action" onClick={onRetry}>Try again</button>}
      </div>
    );
  }

  if (artists.length === 0 && isLoading) {
    return (
      <CardGridSkeleton
        count={18}
        minWidth={CARD_MIN}
        gap={COL_GAP}
        padding={PADDING}
        round
        label="Loading artists"
      />
    );
  }

  if (artists.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">No artists yet</p>
        <p className="empty-state-hint">
          Sync your library from Settings and every artist on your server shows up here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div ref={attachContainer} className="album-grid-scroller">
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowStart = virtualRow.index * cols;
            const rowArtists = artists.slice(rowStart, rowStart + cols);
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: `${virtualRow.start}px`,
                  left: `${PADDING}px`,
                  right: `${PADDING}px`,
                  height: `${Math.round(cardWidth)}px`,
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  gap: `${COL_GAP}px`,
                }}
              >
                {rowArtists.map((artist) => (
                  <ArtistGridCard
                    key={artist.name}
                    artist={artist}
                    cachedImageUrl={artistImageMap.get(artist.name) ?? null}
                    portraitFailed={failedPortraits.has(artist.name)}
                    enrichStale={artist.enriched_at === null || artist.enriched_at * 1000 < staleCutoff}
                    serverWithCredential={serverWithCredential}
                    onSelect={onSelect}
                    onContextMenu={handleContextMenu}
                    onPortraitError={handlePortraitError}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <button onClick={() => { onSelect(contextMenu.artist); setContextMenu(null); }}>
            Open artist
          </button>
          {onStartRadio && (
            <StartRadioSubmenu
              onSelect={(mode) => { onStartRadio(contextMenu.artist, mode); setContextMenu(null); }}
            />
          )}
          <button onClick={() => { setIdentifyArtist(contextMenu.artist); setContextMenu(null); }}>
            Identify on MusicBrainz…
          </button>
        </ContextMenu>
      )}
      {identifyArtist && (
        <ArtistIdentifyDialog
          artistName={identifyArtist.name}
          onClose={() => setIdentifyArtist(null)}
        />
      )}
    </>
  );
}

interface ArtistGridCardProps {
  artist: ArtistRow;
  cachedImageUrl: string | null;
  portraitFailed: boolean;
  enrichStale: boolean;
  serverWithCredential: ServerWithCredential;
  onSelect: (artist: ArtistRow) => void;
  onContextMenu: (e: MouseEvent, artist: ArtistRow) => void;
  onPortraitError: (artistName: string) => void;
}

const ArtistGridCard = memo(function ArtistGridCard({ artist, cachedImageUrl, portraitFailed, enrichStale, serverWithCredential, onSelect, onContextMenu, onPortraitError }: ArtistGridCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { server, credential } = serverWithCredential;

  // Derive image URLs here (not inline in the parent map) and memoize each on its
  // real inputs. resolvePortraitUrl / getCoverArtUrl / getArtistImageUrl each build
  // fresh strings per call, which would otherwise defeat this component's React.memo.
  const portraitUrl = useMemo(() => resolvePortraitUrl(artist), [artist]);
  const fallbackUrl = useMemo(
    () => (artist.artwork_url ? getCoverArtUrl(server.url, server.username, credential, artist.artwork_url, 300) : null),
    [artist.artwork_url, server.url, server.username, credential],
  );
  const imgUrl = useMemo(
    () => (portraitUrl && !portraitFailed ? (cachedImageUrl ?? getArtistImageUrl(portraitUrl)) : fallbackUrl),
    [portraitUrl, portraitFailed, cachedImageUrl, fallbackUrl],
  );
  const hasPortrait = !!portraitUrl;

  // Bind the parent's stable, artist-agnostic handlers to this card's artist here,
  // so the parent can pass one stable callback per handler instead of a fresh
  // closure per card per render (which would defeat this component's React.memo).
  const handleSelect = useCallback(() => onSelect(artist), [onSelect, artist]);
  const handleContextMenu = useCallback((e: MouseEvent) => onContextMenu(e, artist), [onContextMenu, artist]);
  const handlePortraitError = useCallback(() => { if (hasPortrait) onPortraitError(artist.name); }, [onPortraitError, artist.name, hasPortrait]);

  return (
    <div
      ref={cardRef}
      className="album-card"
      onClick={handleSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleSelect()}
      onContextMenu={handleContextMenu}
    >
      {enrichStale && (
        <LazyPortraitEnrich artistName={artist.name} serverWithCredential={serverWithCredential} elRef={cardRef} />
      )}
      {imgUrl ? (
        <img
          className="album-art"
          src={imgUrl}
          alt={artist.name}
          decoding="async"
          loading="lazy"
          onError={handlePortraitError}
        />
      ) : (
        <div className="album-art album-art--placeholder" />
      )}
      <div className="album-overlay">
        <span className="album-name">{artist.name}</span>
        <span className="album-artist">
          {artist.album_count} {artist.album_count === 1 ? "album" : "albums"}
        </span>
      </div>
    </div>
  );
});
