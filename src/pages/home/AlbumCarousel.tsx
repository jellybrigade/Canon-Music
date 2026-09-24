import { useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Play, Radio, RefreshCw } from "lucide-react";
import { useAlbumDisplayName } from "../../hooks/useAlbumDisplayName";
import { getCoverArtUrl } from "../../clients/navidromeUrls";
import type { ServerWithCredential } from "../../hooks/useServer";
import type { AlbumRow } from "../../types/library";
import { useAlbumCoverMap } from "../../hooks/useCoverCache";
import "./AlbumCarousel.css";

interface AlbumCarouselProps {
  title: string;
  subtitle?: string;
  items: AlbumRow[] | undefined;
  isLoading?: boolean;
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  playAlbum: (album: AlbumRow) => void;
  onCardContextMenu: (e: React.MouseEvent, album: AlbumRow) => void;
  onRadio?: () => void;
  onRefresh?: () => void;
}

/** Card stride is measured off the DOM rather than hardcoded: the card width and the
 *  flex gap both live in AlbumCarousel.css, so a constant here silently desyncs when they move
 *  and every arrow click accumulates the difference until cards sit half-cut. */
function cardStride(track: HTMLDivElement): number {
  const card = track.firstElementChild as HTMLElement | null;
  if (!card) return 0;
  const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
  return card.offsetWidth + gap;
}

export function AlbumCarousel({ title, subtitle, items, isLoading, serverWithCred, onSelectAlbum, playAlbum, onCardContextMenu, onRadio, onRefresh }: AlbumCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { server, credential } = serverWithCred;
  const albumDisplayName = useAlbumDisplayName();
  const coverMap = useAlbumCoverMap();
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const itemCount = items?.length ?? 0;
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const update = () => {
      // 1px slack: fractional scroll positions never land exactly on the extent.
      setAtStart(el.scrollLeft <= 1);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [itemCount, isLoading]);

  if (!isLoading && (!items || items.length === 0)) return null;

  const scroll = (dir: "prev" | "next") => {
    const el = trackRef.current;
    if (!el) return;
    const step = cardStride(el) * 3;
    el.scrollBy({ left: dir === "next" ? step : -step, behavior: "smooth" });
  };

  const skeletons = Array.from({ length: 6 });

  return (
    <section className="home-section">
      <div className="home-section__header">
        <h2 className="home-section__title">{title}</h2>
        {subtitle && <p className="home-section__subtitle">{subtitle}</p>}
        {onRadio && (
          <button className="home-section__radio-btn" onClick={onRadio} aria-label={`Start ${title} radio`} title="Start radio">
            <Radio size={13} />
          </button>
        )}
        {onRefresh && (
          <button className="home-section__refresh-btn" onClick={onRefresh} aria-label={`Refresh ${title}`} title="Refresh">
            <RefreshCw size={13} />
          </button>
        )}
      </div>
      <div className="album-carousel">
        <button className="album-carousel__arrow album-carousel__arrow--prev" onClick={() => scroll("prev")} disabled={atStart} aria-label="Scroll left">
          <ChevronLeft size={15} />
        </button>
        <div className="album-carousel__track" ref={trackRef}>
          {isLoading
            ? skeletons.map((_, i) => (
                <div key={i} className="carousel-card carousel-card--skeleton">
                  <div className="carousel-card__art-wrap" />
                  <p className="carousel-card__name">&nbsp;</p>
                  <p className="carousel-card__artist">&nbsp;</p>
                </div>
              ))
            : (items ?? []).map(item => {
                const artUrl = coverMap.get(item.id) ?? (item.artwork_url
                  ? getCoverArtUrl(server.url, server.username, credential, item.artwork_url, 300)
                  : null);
                return (
                  <div
                    key={item.id}
                    className="carousel-card"
                    onClick={() => onSelectAlbum(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === "Enter" && onSelectAlbum(item)}
                    onContextMenu={e => onCardContextMenu(e, item)}
                  >
                    <div className="carousel-card__art-wrap">
                      {artUrl
                        ? <img className="carousel-card__art" src={artUrl} alt={item.name} decoding="async" loading="lazy" />
                        : <div className="carousel-card__art" />}
                      <button
                        className="carousel-card__play"
                        onClick={e => { e.stopPropagation(); void playAlbum(item); }}
                        aria-label={`Play ${item.name}`}
                      >
                        <Play size={13} fill="currentColor" />
                      </button>
                    </div>
                    <p className="carousel-card__name">{albumDisplayName(item.name, item.id)}</p>
                    {item.artist && <p className="carousel-card__artist">{item.artist}</p>}
                  </div>
                );
              })}
        </div>
        <button className="album-carousel__arrow album-carousel__arrow--next" onClick={() => scroll("next")} disabled={atEnd} aria-label="Scroll right">
          <ChevronRight size={15} />
        </button>
      </div>
    </section>
  );
}
