import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { withCoverRevision } from "../clients/navidromeUrls";
import { preloadImage } from "../lib/preloadImage";

/** How long a shown set of albums stays up while the next set's covers load. */
export const COVER_SET_WAIT_MS = 400;

interface HeldSet<T> {
  key: string;
  items: T[];
}

/**
 * Keeps showing `items`' previous set until the new set's covers have loaded, so a refresh or tab
 * switch replaces every card at once instead of blanking each cover until its image arrives.
 */
export function useHeldCoverSet<T extends { id: string }>(items: T[], coverOf: (item: T) => string | null) {
  const wantedKey = items.map((item) => item.id).join("\n");
  const [held, setHeld] = useState<HeldSet<T>>({ key: wantedKey, items });

  if (held.key !== wantedKey && held.items.length === 0) setHeld({ key: wantedKey, items });

  const isHolding = held.key !== wantedKey && held.items.length > 0;
  // A card's cover moves from the server's URL to the local cache's once that read lands, so the
  // preload follows whatever the card would show now.
  const wantedCovers = isHolding
    ? items
        .map(coverOf)
        .filter((url): url is string => url !== null)
        .map(withCoverRevision)
    : [];
  const coversKey = wantedCovers.join("\n");

  // Read when the covers are ready, so the swap shows the latest data, not the data that started it.
  const latestItems = useRef(items);
  useLayoutEffect(() => {
    latestItems.current = items;
  });

  // The deadline belongs to the set, so a cover changing mid-wait doesn't extend it.
  const holdStartedAt = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!isHolding) return;
    if (holdStartedAt.current?.key !== wantedKey) holdStartedAt.current = { key: wantedKey, at: Date.now() };
    let isCurrent = true;
    const swap = () => {
      if (!isCurrent) return;
      isCurrent = false;
      clearTimeout(timer);
      setHeld({ key: wantedKey, items: latestItems.current });
    };
    const remaining = holdStartedAt.current.at + COVER_SET_WAIT_MS - Date.now();
    const timer = setTimeout(swap, Math.max(0, remaining));
    const urls = coversKey === "" ? [] : coversKey.split("\n");
    void Promise.allSettled(urls.map((url) => preloadImage(url))).then(swap);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [wantedKey, isHolding, coversKey]);

  return isHolding ? held.items : items;
}
