import { useEffect, useRef, useState } from "react";
import {
  Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Heart, Loader, ListEnd, PlayCircle,
} from "lucide-react";
import { usePlayerStore } from "../store/player";
import { useLoved } from "../hooks/useLoved";
import { useLyrics } from "../hooks/useLyrics";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow } from "../hooks/useAlbums";
import { getCoverArtUrl, getStreamUrl } from "../lib/navidrome";
import { stripServerPrefix } from "../lib/ids";
import { parseLrc } from "../lib/lrclib";
import { fetchSimilarArtists } from "../lib/lastfm";
import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import "./NowPlayingView.css";

const SECONDS_PER_MINUTE = 60;

type Tab = "up-next" | "about" | "lyrics";

function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / SECONDS_PER_MINUTE);
  const s = total % SECONDS_PER_MINUTE;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface TopTrack {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  album_name: string | null;
  album_id: string | null;
  artwork_url: string | null;
}

interface SuggestedTrack {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  album_name: string | null;
  album_id: string | null;
  artwork_url: string | null;
}

function useArtistAlbums(artistName: string | null) {
  return useQuery({
    queryKey: ["artist-albums", artistName],
    queryFn: async (): Promise<AlbumRow[]> => {
      if (!artistName) return [];
      const db = await getDb();
      return db.select<AlbumRow[]>(
        `SELECT id, server_id, name, artist, year, artwork_url
         FROM albums WHERE artist = ?
         ORDER BY year IS NULL, year DESC, name`,
        [artistName]
      );
    },
    enabled: !!artistName,
  });
}

function useArtistTopTracks(artistName: string | null) {
  return useQuery({
    queryKey: ["artist-top-tracks", artistName],
    queryFn: async (): Promise<TopTrack[]> => {
      if (!artistName) return [];
      const db = await getDb();
      return db.select<TopTrack[]>(
        `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                t.album_id, a.artwork_url
         FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
         WHERE t.artist = ?
         ORDER BY t.track_number, t.title
         LIMIT 10`,
        [artistName]
      );
    },
    enabled: !!artistName,
  });
}

function useSuggestedTracks(artistName: string | null, currentTrackId: string | null) {
  return useQuery({
    queryKey: ["suggested-tracks", artistName],
    queryFn: async (): Promise<SuggestedTrack[]> => {
      if (!artistName) return [];
      const similarArtists = await fetchSimilarArtists(artistName);
      if (similarArtists.length === 0) return [];
      const db = await getDb();
      const placeholders = similarArtists.map(() => "?").join(", ");
      return db.select<SuggestedTrack[]>(
        `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                t.album_id, a.artwork_url
         FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
         WHERE t.artist IN (${placeholders})
           AND t.id != ?
         ORDER BY random()
         LIMIT 10`,
        [...similarArtists, currentTrackId ?? ""]
      );
    },
    enabled: !!artistName,
    staleTime: 5 * 60 * 1000,
  });
}

interface Props {
  serverWithCredential: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist?: (artistName: string) => void;
}

export function NowPlayingView({ serverWithCredential, onSelectAlbum, onSelectArtist }: Props) {
  const {
    currentTrack, isPlaying, isLoading, elapsed, volume,
    queue, queueIndex, repeat, isShuffled, shuffleOrder,
    pause, resume, next, prev, seek, setVolume,
    toggleRepeat, toggleShuffle, playFromQueueIndex,
    playQueue, addToQueue, playNext,
  } = usePlayerStore();
  const { lovedTrackIds, toggleTrackLove } = useLoved();
  const progressBarRef = useRef<HTMLDivElement>(null);
  const upNextRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("up-next");

  const { server, credential } = serverWithCredential;
  const duration = currentTrack?.duration ?? 0;
  const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;
  const nextDisabled = repeat === "off" && queueIndex >= queue.length - 1;
  const isLoved = currentTrack ? lovedTrackIds.has(currentTrack.id) : false;
  const repeatLabel = repeat === "off" ? "Repeat off" : repeat === "repeat-all" ? "Repeat all" : "Repeat one";

  const { data: artistAlbums } = useArtistAlbums(currentTrack?.artist ?? null);
  const { data: topTracks } = useArtistTopTracks(currentTrack?.artist ?? null);
  const { data: suggestedTracks } = useSuggestedTracks(
    currentTrack?.artist ?? null,
    currentTrack?.id ?? null
  );
  const { plain: lyricsPlain, synced: lyricsSynced, loading: lyricsLoading } = useLyrics(currentTrack ?? null);
  const lyricsLines = lyricsSynced ? parseLrc(lyricsSynced) : null;
  const activeLyricRef = useRef<HTMLDivElement>(null);

  const largeArtUrl = currentTrack?.artworkRef
    ? getCoverArtUrl(server.url, server.username, credential, currentTrack.artworkRef, 600)
    : currentTrack?.coverArtUrl ?? null;

  const orderedTracks = Array.from({ length: queue.length }, (_, pos) => {
    const idx = isShuffled && shuffleOrder.length > 0 ? (shuffleOrder[pos] ?? pos) : pos;
    return { position: pos, track: queue[idx]! };
  });

  const otherAlbums = artistAlbums?.filter((a) => a.id !== currentTrack?.albumId) ?? [];

  useEffect(() => {
    if (tab !== "up-next" || !upNextRef.current) return;
    const active = upNextRef.current.querySelector(".now-playing-up-next-row--active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }, [tab]);

  useEffect(() => {
    if (tab !== "lyrics" || !activeLyricRef.current) return;
    activeLyricRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [tab, elapsed]);

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!progressBarRef.current || duration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    void seek(ratio * duration);
  }

  function buildTrack(t: TopTrack | SuggestedTrack) {
    const navId = stripServerPrefix(t.id, server.id);
    const coverArtUrl = t.artwork_url
      ? getCoverArtUrl(server.url, server.username, credential, t.artwork_url, 64)
      : null;
    return {
      track: {
        id: t.id,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
        coverArtUrl,
        artworkRef: t.artwork_url ?? null,
        album: t.album_name ?? null,
        albumId: t.album_id ?? null,
      },
      streamUrl: getStreamUrl(server.url, server.username, credential, navId),
    };
  }

  function handlePlayTrack(t: TopTrack | SuggestedTrack) {
    const { track } = buildTrack(t);
    void playQueue([track], (ct) => getStreamUrl(server.url, server.username, credential, stripServerPrefix(ct.id, server.id)), 0);
  }

  function handleAddToQueue(t: TopTrack | SuggestedTrack) {
    const { track } = buildTrack(t);
    addToQueue(track, (ct) => getStreamUrl(server.url, server.username, credential, stripServerPrefix(ct.id, server.id)));
  }

  function handlePlayNext(t: TopTrack | SuggestedTrack) {
    const { track } = buildTrack(t);
    playNext(track, (ct) => getStreamUrl(server.url, server.username, credential, stripServerPrefix(ct.id, server.id)));
  }

  if (!currentTrack) {
    return (
      <div className="now-playing-view now-playing-view--empty">
        <p className="now-playing-empty">Nothing playing.</p>
      </div>
    );
  }

  const topLeft = topTracks?.slice(0, 5) ?? [];
  const topRight = topTracks?.slice(5, 10) ?? [];

  return (
    <div className="now-playing-view">
      <div className="now-playing-main">
        {/* ── Left: art + chrome ── */}
        <div className="now-playing-left">
          {largeArtUrl ? (
            <img className="now-playing-art" src={largeArtUrl} alt={currentTrack.title} />
          ) : (
            <div className="now-playing-art now-playing-art--placeholder" />
          )}

          <div className="now-playing-info">
            <p className="now-playing-title">{currentTrack.title}</p>
            {currentTrack.artist && (
              onSelectArtist ? (
                <button
                  className="now-playing-artist now-playing-artist--link"
                  onClick={() => onSelectArtist(currentTrack.artist!)}
                >
                  {currentTrack.artist}
                </button>
              ) : (
                <p className="now-playing-artist">{currentTrack.artist}</p>
              )
            )}
            {currentTrack.album && (
              <p className="now-playing-album">{currentTrack.album}</p>
            )}
          </div>

          <div className="now-playing-progress-row">
            <span className="player-elapsed">{formatDuration(elapsed)}</span>
            <div
              ref={progressBarRef}
              className="now-playing-progress-bar"
              onClick={handleProgressClick}
              style={{ cursor: duration > 0 ? "pointer" : "default" }}
            >
              <div className="now-playing-progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <span className="player-duration">{duration > 0 ? formatDuration(duration) : ""}</span>
          </div>

          <div className="now-playing-controls">
            <button
              className={`player-btn player-btn--icon${isShuffled ? " player-btn--active" : ""}`}
              onClick={toggleShuffle}
              title="Shuffle"
            >
              <Shuffle size={16} />
            </button>
            <button
              className="player-btn"
              onClick={() => void prev()}
              disabled={queue.length === 0}
            >
              <SkipBack size={22} />
            </button>
            <button
              className="player-btn player-btn--play player-btn--play-large"
              onClick={isPlaying ? pause : resume}
              disabled={isLoading}
            >
              {isLoading
                ? <Loader size={20} className="player-spin" />
                : isPlaying
                  ? <Pause size={20} fill="currentColor" strokeWidth={0} />
                  : <Play size={20} fill="currentColor" strokeWidth={0} />}
            </button>
            <button
              className="player-btn"
              onClick={() => void next()}
              disabled={nextDisabled}
            >
              <SkipForward size={22} />
            </button>
            <button
              className={`player-btn player-btn--icon${repeat !== "off" ? " player-btn--active" : ""}`}
              onClick={() => void toggleRepeat()}
              title={repeatLabel}
            >
              {repeat === "repeat-one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
            </button>
          </div>

          <div className="now-playing-extras">
            <button
              className={`player-btn player-btn--icon${isLoved ? " player-btn--active" : ""}`}
              onClick={() => void toggleTrackLove(currentTrack.id, serverWithCredential)}
              title={isLoved ? "Unlove" : "Love"}
            >
              <Heart size={16} fill={isLoved ? "currentColor" : "none"} strokeWidth={isLoved ? 0 : 2} />
            </button>
            <div className="now-playing-volume">
              <input
                type="range"
                className="player-volume-slider"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => void setVolume(parseFloat(e.target.value))}
                aria-label="Volume"
              />
            </div>
          </div>
        </div>

        {/* ── Right: tabbed panel ── */}
        <div className="now-playing-right">
          <div className="now-playing-tabs" role="tablist">
            {(["up-next", "about", "lyrics"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`now-playing-tab-btn${tab === t ? " now-playing-tab-btn--active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t === "up-next" ? "Up Next" : t === "about" ? "About" : "Lyrics"}
              </button>
            ))}
          </div>

          <div className="now-playing-tab-panel" ref={tab === "up-next" ? upNextRef : undefined}>
            {tab === "up-next" && (
              <>
                {orderedTracks.length === 0 ? (
                  <p className="now-playing-empty">Queue is empty.</p>
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
                    >
                      <span className="now-playing-up-next-indicator">
                        {position === queueIndex ? <Play size={10} /> : null}
                      </span>
                      {track.artworkRef ? (
                        <img
                          className="now-playing-up-next-thumb"
                          src={getCoverArtUrl(server.url, server.username, credential, track.artworkRef, 64)}
                          alt=""
                        />
                      ) : track.coverArtUrl ? (
                        <img className="now-playing-up-next-thumb" src={track.coverArtUrl} alt="" />
                      ) : (
                        <div className="now-playing-up-next-thumb now-playing-up-next-thumb--placeholder" />
                      )}
                      <div className="now-playing-up-next-info">
                        <span className="now-playing-up-next-title">{track.title}</span>
                        <span className="now-playing-up-next-meta">
                          {[track.artist, track.album].filter(Boolean).join(" • ")}
                        </span>
                      </div>
                      {track.duration != null && (
                        <span className="now-playing-up-next-duration">
                          {formatDuration(track.duration)}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </>
            )}

            {tab === "about" && (
              <>
                {otherAlbums.length > 0 && (
                  <div className="now-playing-more-section">
                    <h3 className="now-playing-section-title">More from {currentTrack.artist}</h3>
                    <div className="now-playing-album-scroll">
                      {otherAlbums.map((album) => {
                        const thumbUrl = album.artwork_url
                          ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 120)
                          : null;
                        return (
                          <button
                            key={album.id}
                            className="now-playing-album-chip"
                            onClick={() => onSelectAlbum(album)}
                          >
                            {thumbUrl
                              ? <img src={thumbUrl} alt={album.name} className="now-playing-album-chip-art" />
                              : <div className="now-playing-album-chip-art now-playing-album-chip-art--placeholder" />
                            }
                            <span className="now-playing-album-chip-name">{album.name}</span>
                            {album.year && <span className="now-playing-album-chip-year">{album.year}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {topTracks && topTracks.length > 0 && (
                  <div className="now-playing-more-section">
                    <h3 className="now-playing-section-title">Top tracks — {currentTrack.artist}</h3>
                    <div className="now-playing-top-tracks-grid">
                      {[topLeft, topRight].map((col, ci) => (
                        <div key={ci} className="now-playing-top-tracks-col">
                          {col.map((track, i) => (
                            <div key={track.id} className="now-playing-track-row">
                              <span className="now-playing-track-num">{ci * 5 + i + 1}</span>
                              <div className="now-playing-track-info">
                                <span className="now-playing-track-title">{track.title}</span>
                                {track.album_name && (
                                  <span className="now-playing-track-album">{track.album_name}</span>
                                )}
                              </div>
                              {track.duration && (
                                <span className="now-playing-track-duration">
                                  {formatDuration(track.duration)}
                                </span>
                              )}
                              <div className="now-playing-track-actions">
                                <button
                                  className="now-playing-track-action-btn"
                                  title="Play now"
                                  onClick={(e) => { e.stopPropagation(); handlePlayTrack(track); }}
                                >
                                  <PlayCircle size={14} />
                                </button>
                                <button
                                  className="now-playing-track-action-btn"
                                  title="Play next"
                                  onClick={(e) => { e.stopPropagation(); handlePlayNext(track); }}
                                >
                                  <Play size={12} />
                                </button>
                                <button
                                  className="now-playing-track-action-btn"
                                  title="Add to queue"
                                  onClick={(e) => { e.stopPropagation(); handleAddToQueue(track); }}
                                >
                                  <ListEnd size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {suggestedTracks && suggestedTracks.length > 0 && (
                  <div className="now-playing-more-section">
                    <h3 className="now-playing-section-title">Suggested</h3>
                    <div className="now-playing-top-tracks-col">
                      {suggestedTracks.map((track) => (
                        <div key={track.id} className="now-playing-track-row">
                          <div className="now-playing-track-info">
                            <span className="now-playing-track-title">{track.title}</span>
                            <span className="now-playing-track-album">
                              {[track.artist, track.album_name].filter(Boolean).join(" — ")}
                            </span>
                          </div>
                          {track.duration && (
                            <span className="now-playing-track-duration">
                              {formatDuration(track.duration)}
                            </span>
                          )}
                          <div className="now-playing-track-actions">
                            <button
                              className="now-playing-track-action-btn"
                              title="Play now"
                              onClick={() => handlePlayTrack(track)}
                            >
                              <PlayCircle size={14} />
                            </button>
                            <button
                              className="now-playing-track-action-btn"
                              title="Play next"
                              onClick={() => handlePlayNext(track)}
                            >
                              <Play size={12} />
                            </button>
                            <button
                              className="now-playing-track-action-btn"
                              title="Add to queue"
                              onClick={() => handleAddToQueue(track)}
                            >
                              <ListEnd size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {otherAlbums.length === 0 && (!topTracks || topTracks.length === 0) && (
                  <p className="now-playing-empty">No artist info available.</p>
                )}
              </>
            )}

            {tab === "lyrics" && (
              <div className="now-playing-lyrics">
                {lyricsLoading ? (
                  <p className="now-playing-empty">Loading lyrics…</p>
                ) : lyricsLines && lyricsLines.length > 0 ? (
                  lyricsLines.map((line, i) => {
                    const isActive = elapsed >= line.timeSec &&
                      (i === lyricsLines.length - 1 || elapsed < lyricsLines[i + 1]!.timeSec);
                    return (
                      <div
                        key={i}
                        ref={isActive ? activeLyricRef : undefined}
                        className={`lyrics-line${isActive ? " lyrics-line--active" : ""}`}
                      >
                        {line.text || " "}
                      </div>
                    );
                  })
                ) : lyricsPlain ? (
                  <pre className="lyrics-plain">{lyricsPlain}</pre>
                ) : (
                  <p className="now-playing-empty">No lyrics found.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
