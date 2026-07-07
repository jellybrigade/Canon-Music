import { useLayoutEffect, useRef, useState } from "react";

const ROWS_PER_PAGE = 4;

interface Options {
  padding: number;
  colGap: number;
  cardMin: number;
  resetKey?: unknown;
}

export function useGridPagination(itemCount: number, { padding, colGap, cardMin, resetKey }: Options) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [page, setPage] = useState(1);

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

  const available = containerWidth > 0 ? containerWidth - padding * 2 : 0;
  const cols = Math.max(1, Math.floor((available + colGap) / (cardMin + colGap)));
  const cardWidth = available > 0 ? (available - colGap * (cols - 1)) / cols : cardMin;
  const pageSize = cols * ROWS_PER_PAGE;

  useLayoutEffect(() => { setPage(1); }, [resetKey, pageSize]);

  const totalPages = Math.max(1, Math.ceil(itemCount / pageSize));
  const clampedPage = Math.min(page, totalPages);

  return { containerRef, cols, cardWidth, page: clampedPage, setPage, pageSize };
}
