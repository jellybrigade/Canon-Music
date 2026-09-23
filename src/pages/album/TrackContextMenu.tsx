import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ContextMenu, ContextMenuSubmenu } from "../../ui/ContextMenu";
import { StartRadioSubmenu } from "../../features/radio/components/StartRadioSubmenu";
import type { RadioMode } from "../../features/playback/store/playerTypes";
import type { PlaylistRow } from "../../features/playlists/usePlaylists";
import type { TrackGenre } from "./albumGenres";

interface Props {
  x: number;
  y: number;
  isLoved: boolean;
  overflowGenres: TrackGenre[];
  playlists: PlaylistRow[] | undefined;
  onClose: () => void;
  onPlayNow: () => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onStartRadio: (mode: RadioMode) => void;
  onToggleLove: () => void;
  onShowTags: () => void;
  onTagFilter?: (canonicalId: string) => void;
  onAddToPlaylist: (playlist: PlaylistRow) => void;
}

export function TrackContextMenu({
  x,
  y,
  isLoved,
  overflowGenres,
  playlists,
  onClose,
  onPlayNow,
  onPlayNext,
  onAddToQueue,
  onStartRadio,
  onToggleLove,
  onShowTags,
  onTagFilter,
  onAddToPlaylist,
}: Props) {
  const [mode, setMode] = useState<"main" | "playlist">("main");
  const then = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {mode === "main" ? (
        <>
          <button onClick={then(onPlayNow)}>Play Now</button>
          <button onClick={then(onPlayNext)}>Play Next</button>
          <button onClick={then(onAddToQueue)}>Add to Queue</button>
          <StartRadioSubmenu
            onSelect={(radioMode) => {
              onStartRadio(radioMode);
              onClose();
            }}
          />
          <button onClick={then(onToggleLove)}>
            {isLoved ? "Unlove track" : "Love track"}
          </button>
          <button onClick={then(onShowTags)}>Show tags</button>
          {overflowGenres.length > 0 && (
            <ContextMenuSubmenu label="More genres">
              {overflowGenres.map((g) => (
                <button key={g.canonicalId} onClick={then(() => onTagFilter?.(g.canonicalId))}>
                  {g.display}
                </button>
              ))}
            </ContextMenuSubmenu>
          )}
          {playlists && playlists.length > 0 && (
            <button onClick={() => setMode("playlist")}>
              Add to Playlist <ChevronRight size={16} />
            </button>
          )}
        </>
      ) : (
        <>
          <button onClick={() => setMode("main")}>← Back</button>
          {playlists?.map((pl) => (
            <button key={pl.id} onClick={then(() => onAddToPlaylist(pl))}>
              {pl.name}
            </button>
          ))}
        </>
      )}
    </ContextMenu>
  );
}
