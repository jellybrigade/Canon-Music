import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import "./AlbumCarousel.css";

interface CarouselTrackProps {
  children: ReactNode;
  /** Each increment scrolls the carousel back to its first card. */
  scrollToStartRequest?: number;
}

/** Card stride is measured off the DOM rather than hardcoded: the card width and the
 *  flex gap both live in AlbumCarousel.css, so a constant here silently desyncs when they move
 *  and every arrow click accumulates the difference until cards sit half-cut. */
function cardStride(track: HTMLDivElement): number {
  const card = track.firstElementChild as HTMLElement | null;
  if (!card) return 0;
  const gap = parseFloat(getComputedStyle(track).columnGap);
  return card.offsetWidth + (Number.isFinite(gap) ? gap : 0);
}

export function CarouselTrack({ children, scrollToStartRequest = 0 }: CarouselTrackProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const updateEnds = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    // 1px slack: fractional scroll positions never land exactly on the extent.
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateEnds, { passive: true });
    const ro = new ResizeObserver(updateEnds);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateEnds);
      ro.disconnect();
    };
  }, [updateEnds]);

  // No deps: new cards change the scroll width without resizing the track, and equal values bail out of the render.
  useEffect(updateEnds);

  useEffect(() => {
    if (scrollToStartRequest === 0) return;
    // The track's own `scroll-behavior: smooth` animates this.
    trackRef.current?.scrollTo({ left: 0 });
  }, [scrollToStartRequest]);

  const scroll = (dir: "prev" | "next") => {
    const el = trackRef.current;
    if (!el) return;
    const step = cardStride(el) * 3;
    el.scrollBy({ left: dir === "next" ? step : -step, behavior: "smooth" });
  };

  return (
    <div className="album-carousel">
      <button
        className="album-carousel__arrow album-carousel__arrow--prev"
        onClick={() => scroll("prev")}
        disabled={atStart}
        aria-label="Scroll left"
      >
        <ChevronLeft size={15} />
      </button>
      <div className="album-carousel__track" ref={trackRef}>
        {children}
      </div>
      <button
        className="album-carousel__arrow album-carousel__arrow--next"
        onClick={() => scroll("next")}
        disabled={atEnd}
        aria-label="Scroll right"
      >
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
