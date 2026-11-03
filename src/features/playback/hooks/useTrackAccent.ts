import { useEffect } from "react";
import { useCoverUrl } from "../../../hooks/useCoverRevisions";
import { extractAccent } from "../../../lib/artColor";
import { usePlayerStore } from "../store/player";

const ACCENT_PROPERTIES = ["--accent", "--accent-hover", "--accent-subtle"] as const;

/** Tints the app accent from the playing track's cover, following a cover chosen mid-track. */
export function useTrackAccent(): void {
  const coverUrl = useCoverUrl(usePlayerStore((s) => s.currentTrack?.coverArtUrl ?? null));
  const setAccentColor = usePlayerStore((s) => s.setAccentColor);

  useEffect(() => {
    const rootStyle = document.documentElement.style;
    if (!coverUrl) {
      setAccentColor(null);
      for (const property of ACCENT_PROPERTIES) rootStyle.removeProperty(property);
      return;
    }
    let cancelled = false;
    void extractAccent(coverUrl).then((color) => {
      if (cancelled) return;
      setAccentColor(color);
      if (!color) return;
      rootStyle.setProperty("--accent", color);
      rootStyle.setProperty("--accent-hover", `color-mix(in oklab, ${color} 85%, black)`);
      const channels = color.match(/\d+/g);
      if (channels) {
        rootStyle.setProperty("--accent-subtle", `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, 0.18)`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [coverUrl, setAccentColor]);
}
