import { AudioLines, Image as ImageIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { AlbumArt } from "../../../components/AlbumArt";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion";
import { useBoolSetting } from "../../../hooks/useSetting";
import { isTextEntryTarget } from "../../../lib/keyboard";
import { useOverlayAbove } from "../../../ui/keyboardOwners";
import { SHOW_VISUALIZER_KEY, VISUALIZER_ENABLED_KEY } from "../lib/visualizerSettings";
import { usePlayerStore } from "../store/player";
import { Visualizer } from "./Visualizer";

interface Props {
  artUrl: string | null;
  artist: string | null;
  album: string | null;
  title: string;
}

function unavailableReason(isCasting: boolean, prefersReducedMotion: boolean, hasError: boolean): string | null {
  if (isCasting) return "Visualizer isn't available while casting";
  if (prefersReducedMotion) return "Visualizer is off while your system asks for reduced motion";
  if (hasError) return "Visualizer isn't available while playback has an error";
  return null;
}

/** The album art, or in its place a visualizer of what's playing. */
export function NowPlayingArt({ artUrl, artist, album, title }: Props) {
  const [isVisualizerEnabled] = useBoolSetting(VISUALIZER_ENABLED_KEY, true);
  const [wantsVisualizer, setWantsVisualizer] = useBoolSetting(SHOW_VISUALIZER_KEY, false);
  const isCasting = usePlayerStore((s) => s.castDevice !== null);
  const hasError = usePlayerStore((s) => s.error !== null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const isOverlayAbove = useOverlayAbove();

  const reason = unavailableReason(isCasting, prefersReducedMotion, hasError);
  const canToggle = isVisualizerEnabled && reason === null;
  const isShowingVisualizer = canToggle && wantsVisualizer;
  // Read at keypress so toggling doesn't re-arm the listener.
  const wantsVisualizerRef = useRef(wantsVisualizer);
  wantsVisualizerRef.current = wantsVisualizer;

  useEffect(() => {
    if (!canToggle || isOverlayAbove) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "v" && e.key !== "V") return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTextEntryTarget(e)) return;
      void setWantsVisualizer(!wantsVisualizerRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [canToggle, isOverlayAbove, setWantsVisualizer]);

  const toggleLabel = reason ?? (isShowingVisualizer ? "Show album art (V)" : "Show visualizer (V)");

  return (
    <div className={`now-playing-art-stage${isShowingVisualizer ? " now-playing-art-stage--visualizer" : ""}`}>
      {artUrl ? (
        <AlbumArt src={artUrl} artist={artist} album={album} alt={title} className="now-playing-art" />
      ) : (
        <div className="now-playing-art now-playing-art--placeholder" />
      )}
      {isShowingVisualizer && <Visualizer />}
      {isVisualizerEnabled && (
        <button
          type="button"
          className="now-playing-visualizer-toggle"
          onClick={() => void setWantsVisualizer(!wantsVisualizer)}
          disabled={!canToggle}
          aria-pressed={isShowingVisualizer}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          {isShowingVisualizer ? <ImageIcon size={16} /> : <AudioLines size={16} />}
        </button>
      )}
    </div>
  );
}
