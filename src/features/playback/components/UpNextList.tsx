import { useMemo, useState } from "react";
import { Heart, Play } from "lucide-react";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/playerTypes";
import { formatDuration } from "../hooks/useSeekBar";
import { useAlbumDisplayName } from "../../../hooks/useAlbumDisplayName";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { getCoverArtUrl } from "../../../clients/navidromeUrls";
import { RadioQueueStatus } from "../../radio/components/RadioQueueStatus";
import { ContextMenu } from "../../../ui/ContextMenu";
import { StartRadioSubmenu } from "../../radio/components/StartRadioSubmenu";
import type { AlbumRow } from "../../../types/library";
import { albumRowOfTrack } from "../lib/trackAlbum";
import "./UpNextList.css";

interface Props {
  serverWithCredential: ServerWithCredential;
  lovedTrackIds: Set<string>;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist?: (artistName: string) => void;
}

export function UpNextList({ serverWithCredential, lovedTrackIds, onSelectAlbum, onSelectArtist }: Props) {
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const isShuffled = usePlayerStore((s) => s.isShuffled);
  const shuffleOrder = usePlayerStore((s) => s.shuffleOrder);
  const playFromQueueIndex = usePlayerStore((s) => s.playFromQueueIndex);
  const moveQueueItem = usePlayerStore((s) => s.moveQueueItem);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const albumDisplayName = useAlbumDisplayName();
  const [upNextMenu, setUpNextMenu] = useState<{ x: number; y: number; position: number } | null>(null);
  const { server, credential } = serverWithCredential;

  const orderedTracks = useMemo(
    () => Array.from({ length: queue.length }, (_, pos) => {
      const idx = isShuffled && shuffleOrder.length > 0 ? (shuffleOrder[pos] ?? pos) : pos;
      return { position: pos, track: queue[idx] };
    }).filter((row): row is { position: number; track: CurrentTrack } => row.track != null),
    [queue, isShuffled, shuffleOrder]
  );
  const menuTrack = upNextMenu ? orderedTracks.find((t) => t.position === upNextMenu.position)?.track : undefined;
  const menuArtist = menuTrack?.artist ?? null;
  const menuAlbum = menuTrack ? albumRowOfTrack(menuTrack) : null;

  return (
    <>
      {orderedTracks.length === 0 ? (
        <p className="now-playing-empty">Nothing queued. Play an album or track, or use "Add to queue" from any track menu.</p>
      ) : (
        orderedTracks.map(({ position, track }) => (
          <button
            key={`${track.id}-${position}`}
            className={[
              "now-playing-up-next-row",
              position === queueIndex ? "now-playing-up-next-row--active" : "",
              position < queueIndex ? "now-playing-up-next-row--past" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => void playFromQueueIndex(position)}
            onContextMenu={(e) => {
              e.preventDefault();
              setUpNextMenu({ x: e.clientX, y: e.clientY, position });
            }}
          >
            <span className="now-playing-up-next-indicator">
              {position === queueIndex ? <Play size={12} /> : null}
            </span>
            {track.artworkRef ? (
              <img
                className="now-playing-up-next-thumb"
                src={getCoverArtUrl(server.url, server.username, credential, track.artworkRef, 64)}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ) : track.coverArtUrl ? (
              <img className="now-playing-up-next-thumb" src={track.coverArtUrl} alt="" loading="lazy" decoding="async" />
            ) : (
              <div className="now-playing-up-next-thumb now-playing-up-next-thumb--placeholder" />
            )}
            <div className="now-playing-up-next-info">
              <div className="now-playing-up-next-title-row">
                <span className="now-playing-up-next-title">{track.title}</span>
              </div>
              <div className="now-playing-up-next-meta">
                <span className="now-playing-up-next-meta-text">
                  {[track.artist, track.album ? albumDisplayName(track.album) : null].filter(Boolean).join(" • ")}
                </span>
              </div>
            </div>
            <div className="now-playing-up-next-side">
              {track.duration != null && (
                <span className="now-playing-up-next-duration">
                  {formatDuration(track.duration)}
                </span>
              )}
              <span className="now-playing-up-next-loved-slot">
                {lovedTrackIds.has(track.id) && (
                  <Heart size={10} className="now-playing-up-next-loved" fill="currentColor" strokeWidth={0} />
                )}
              </span>
            </div>
          </button>
        ))
      )}
      <RadioQueueStatus />

      {upNextMenu && (
        <ContextMenu x={upNextMenu.x} y={upNextMenu.y} onClose={() => setUpNextMenu(null)}>
          {upNextMenu.position !== 0 && (
            <button
              onClick={() => {
                moveQueueItem(upNextMenu.position, 0);
                setUpNextMenu(null);
              }}
            >
              Move to Top
            </button>
          )}
          {queueIndex + 1 < queue.length && upNextMenu.position !== queueIndex + 1 && upNextMenu.position !== queueIndex && (
            <button
              onClick={() => {
                moveQueueItem(upNextMenu.position, queueIndex + 1);
                setUpNextMenu(null);
              }}
            >
              Play Next
            </button>
          )}
          {upNextMenu.position !== queue.length - 1 && (
            <button
              onClick={() => {
                moveQueueItem(upNextMenu.position, queue.length - 1);
                setUpNextMenu(null);
              }}
            >
              Move to Bottom
            </button>
          )}
          {menuAlbum && (
            <button onClick={() => { onSelectAlbum(menuAlbum); setUpNextMenu(null); }}>
              Go to Album
            </button>
          )}
          {onSelectArtist && menuArtist && (
            <button onClick={() => { onSelectArtist(menuArtist); setUpNextMenu(null); }}>
              Go to Artist
            </button>
          )}
          <StartRadioSubmenu
            onSelect={(mode) => {
              if (menuTrack) {
                void playFromQueueIndex(upNextMenu.position).then(() => {
                  startRadio(menuTrack, mode);
                });
              }
              setUpNextMenu(null);
            }}
          />
          <button
            className="context-menu-danger"
            onClick={() => {
              void removeFromQueue(upNextMenu.position);
              setUpNextMenu(null);
            }}
          >
            Remove
          </button>
        </ContextMenu>
      )}
    </>
  );
}
