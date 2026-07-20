import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ArtistRow } from "../types/library";
import type { ServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl, getArtistImageUrl } from "../lib/navidrome";
import { resolvePortraitUrl } from "../lib/lastfm";
import { useArtistImageMap } from "../hooks/useArtistImageCache";
import { useEnrichArtist } from "../hooks/useEnrichArtist";
import { ContextMenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import { ArtistIdentifyDialog } from "./IdentifyDialog";
import type { RadioMode } from "../store/player";
import { useSetting } from "../hooks/useSetting";

/** Lazily triggers portrait enrichment once a grid tile scrolls into view, so
 * artists never opened individually still pick up a portrait (Navidrome scrape,
 * Wikidata, etc.) instead of staying on the album-cover fallback forever.
 * Rendered as a null component (not a hook in the card) so the grid can skip it
 * entirely for artists whose enrichment is already fresh - the common case -
 * instead of mounting a query per card. */
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
}

export function ArtistGrid({ artists, serverWithCredential, onSelect, onStartRadio }: Props) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; artist: ArtistRow } | null>(null);
  const [identifyArtist, setIdentifyArtist] = useState<ArtistRow | null>(null);
  const [failedPortraits, setFailedPortraits] = useState<Set<string>>(new Set());
  const artistImageMap = useArtistImageMap();

  // Stable, artist-agnostic handlers passed to every ArtistGridCard. The card binds
  // them to its own artist internally, so these references never change per render
  // and don't defeat ArtistGridCard's React.memo. (setContextMenu / setFailedPortraits
  // are stable useState setters, so empty deps are correct.)
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

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.offsetWidth);
    const obs = new ResizeObserver(([entry]) => {
      setContainerWidth(entry!.contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const available = containerWidth > 0 ? containerWidth - PADDING * 2 : 0;
  const cols = Math.max(1, Math.floor((available + COL_GAP) / (CARD_MIN + COL_GAP)));
  const cardWidth = available > 0 ? (available - COL_GAP * (cols - 1)) / cols : CARD_MIN;
  const rowHeight = Math.round(cardWidth) + ROW_GAP;
  const rowCount = Math.ceil(artists.length / cols);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  const prevLayoutKey = useRef(`${cols}-${rowHeight}`);
  useLayoutEffect(() => {
    const key = `${cols}-${rowHeight}`;
    if (prevLayoutKey.current !== key) {
      prevLayoutKey.current = key;
      virtualizer.measure();
    }
  }, [cols, rowHeight, virtualizer]);

  if (artists.length === 0) {
    return <p className="empty-state">No artists found. Sync first.</p>;
  }

  return (
    <>
      <div ref={containerRef} className="album-grid-scroller">
        <div style={{ height: `${virtualizer.getTotalSize() + PADDING * 2}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowStart = virtualRow.index * cols;
            const rowArtists = artists.slice(rowStart, rowStart + cols);
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: `${PADDING + virtualRow.start}px`,
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
