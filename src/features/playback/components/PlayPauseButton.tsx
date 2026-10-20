import { Loader, Pause, Play } from "lucide-react";
import { usePlayerStore } from "../store/player";

interface Props {
  className: string;
  iconSize: number;
}

export function PlayPauseButton({ className, iconSize }: Props) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);

  return (
    <button
      className={className}
      onClick={isPlaying ? pause : resume}
      disabled={isLoading}
      aria-label={isPlaying ? "Pause" : "Play"}
    >
      {isLoading ? (
        <Loader size={iconSize} className="player-spin" />
      ) : isPlaying ? (
        <Pause size={iconSize} fill="currentColor" strokeWidth={0} />
      ) : (
        <Play size={iconSize} fill="currentColor" strokeWidth={0} />
      )}
    </button>
  );
}
