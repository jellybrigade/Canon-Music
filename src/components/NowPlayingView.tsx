import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAlbumDisplayName } from "../hooks/useAlbumDisplayName";
import { WaveformBars } from "./WaveformBars";
import {
  Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Heart, Loader, ListEnd, PlayCircle, Volume2, VolumeX, ChevronLeft, RefreshCw, ListX, AlertCircle,
} from "lucide-react";
import { usePlayerStore, isNextDisabled, repeatModeLabel, type CurrentTrack, type RadioMode } from "../store/player";
import { useLoved } from "../hooks/useLoved";
import { useLyrics, type LyricsOverride } from "../hooks/useLyrics";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow } from "../types/library";
import { getCoverArtUrl, getStreamUrl } from "../lib/navidrome";
import { getBlurredBackdrop } from "../lib/artBlur";
import { RadioChip } from "./RadioChip";
import { ContextMenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import { stripServerPrefix } from "../utils/ids";
import { parseLrc, type LrcLine } from "../lib/lrclib";
import { fetchSimilarArtists, fetchArtistTopTracks } from "../lib/lastfm";
import { fetchBandsintownEvents, type BandsintownEvent } from "../lib/bandsintown";
import { useBoolSetting } from "../hooks/useSetting";
import { useSeekBar, formatDuration } from "../hooks/useSeekBar";
import { TourCard } from "./TourCard";
import { useQuery } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { getDb } from "../db";
import { AlbumArt } from "./AlbumArt";
import "./NowPlayingView.css";

type Tab = "up-next" | "about" | "lyrics";

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
    queryKey: QK.nowPlayingAlbums(artistName),
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
    queryKey: QK.nowPlayingTopTracks(artistName),
    queryFn: async (): Promise<TopTrack[]> => {
      if (!artistName) return [];
      const db = await getDb();

      // Try Last.fm global popularity ranking first
      const trackNames = await fetchArtistTopTracks(artistName);
      if (trackNames.length > 0) {
        const localTracks = await db.select<TopTrack[]>(
          `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                  t.album_id, a.artwork_url
           FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
           WHERE t.artist = ? OR t.artist LIKE ? ESCAPE '\' OR t.artist LIKE ? ESCAPE '\' OR t.artist LIKE ? ESCAPE '\'`,
          [artistName, artistName + ' feat.%', artistName + ' ft.%', artistName + ' featuring %']
        );
        const byTitle = new Map(localTracks.map((t) => [t.title.toLowerCase(), t]));
        const matched: TopTrack[] = [];
        for (const { name } of trackNames) {
          const track = byTitle.get(name.toLowerCase());
          if (track && !matched.some((m) => m.id === track.id)) {
            matched.push(track);
            if (matched.length >= 10) break;
          }
        }
        if (matched.length > 0) return matched;
      }

      // Fallback: local library ordering
      return db.select<TopTrack[]>(
        `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                t.album_id, a.artwork_url
         FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
         WHERE t.artist = ? OR t.artist LIKE ? ESCAPE '\' OR t.artist LIKE ? ESCAPE '\' OR t.artist LIKE ? ESCAPE '\'
         ORDER BY t.track_number, t.title
         LIMIT 10`,
        [artistName, artistName + ' feat.%', artistName + ' ft.%', artistName + ' featuring %']
      );
    },
    enabled: !!artistName,
    staleTime: 30 * 60 * 1000,
  });
}

function useSuggestedTracks(artistName: string | null, currentTrackId: string | null) {
  return useQuery({
    queryKey: QK.suggestedTracks(artistName, currentTrackId),
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
  onStartRadio: (album: AlbumRow, mode: RadioMode) => void;
  onBack?: () => void;
}

function NowPlayingProgress({
  duration, useWaveform, overlayPeaks,
}: {
  duration: number;
  useWaveform: boolean;
  overlayPeaks: number[] | null;
}) {
  const { barRef, elapsed, progress, sliderProps } = useSeekBar(duration);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const overlayFilledCount = useMemo(
    () => (overlayPeaks ? Math.round(progress * overlayPeaks.length) : 0),
    [progress, overlayPeaks]
  );

  return (
    <div className="now-playing-progress-row">
      <span className="player-elapsed">{formatDuration(elapsed)}</span>
      <div
        ref={barRef}
        className={`now-playing-progress-bar${useWaveform ? " now-playing-progress-bar--waveform" : ""}${isBuffering ? " now-playing-progress-bar--buffering" : ""}`}
        aria-busy={isBuffering || undefined}
        {...sliderProps}
      >
        {useWaveform ? (
          <WaveformBars
            peaks={overlayPeaks!}
            filledCount={overlayFilledCount}
            barClass="now-playing-waveform-bar"
            filledClass="now-playing-waveform-bar now-playing-waveform-bar--filled"
          />
        ) : (
          <div className="now-playing-progress-fill" style={{ transform: `scaleX(${progress})` }} />
        )}
      </div>
      <span className="player-duration">{duration > 0 ? formatDuration(duration) : ""}</span>
    </div>
  );
}

interface LyricsTabPanelProps {
  lyricsLines: LrcLine[] | null;
  lyricsPlain: string | null;
  lyricsLoading: boolean;
  lyricsOffsetMs: number;
  lyricsSearchOpen: boolean;
  lyricsSearchArtist: string;
  lyricsSearchTitle: string;
  setLyricsSearchArtist: (v: string) => void;
  setLyricsSearchTitle: (v: string) => void;
  lyricsOverride: LyricsOverride | null;
  setLyricsOverride: (v: LyricsOverride | null) => void;
  currentTrackArtist: string | null;
  currentTrackTitle: string | null;
  onSeek: (timeSec: number) => void;
}

interface LyricLineProps {
  index: number;
  text: string;
  isActive: boolean;
}

const LyricLine = React.memo(function LyricLine({ index, text, isActive }: LyricLineProps) {
  const activeLyricRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={isActive ? activeLyricRef : undefined}
      data-lyric-index={index}
      className={`lyrics-line${isActive ? " lyrics-line--active" : ""}`}
      style={{ cursor: "pointer" }}
    >
      {text || " "}
    </div>
  );
});

function LyricsTabPanel({
  lyricsLines, lyricsPlain, lyricsLoading, lyricsOffsetMs,
  lyricsSearchOpen, lyricsSearchArtist, lyricsSearchTitle,
  setLyricsSearchArtist, setLyricsSearchTitle,
  lyricsOverride, setLyricsOverride,
  currentTrackArtist, currentTrackTitle, onSeek,
}: LyricsTabPanelProps) {
  const elapsed = usePlayerStore((s) => s.elapsed);
  const lyricsAdjElapsed = elapsed - lyricsOffsetMs / 1000;
  const activeLyricIndexRef = useRef<number>(-1);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const userScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScrollingRef = useRef(false);
  const [showResyncPill, setShowResyncPill] = useState(false);

  function scrollToActiveLine() {
    const container = lyricsContainerRef.current;
    if (!container) return;
    const line = container.querySelector<HTMLDivElement>(`[data-lyric-index="${activeLyricIndexRef.current}"]`);
    if (!line) return;
    const targetScrollTop = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2;
    autoScrollingRef.current = true;
    container.scrollTo({ top: Math.max(0, Math.min(targetScrollTop, container.scrollHeight - container.clientHeight)), behavior: "smooth" });
    if (resyncTimeoutRef.current) clearTimeout(resyncTimeoutRef.current);
    resyncTimeoutRef.current = setTimeout(() => { autoScrollingRef.current = false; }, 500);
  }

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      if (resyncTimeoutRef.current) clearTimeout(resyncTimeoutRef.current);
    };
  }, []);

  const activeLyricIndex = useMemo(() => {
    if (!lyricsLines || lyricsLines.length === 0) return -1;
    const isMatch = (i: number) =>
      lyricsAdjElapsed >= lyricsLines[i]!.timeSec && (i === lyricsLines.length - 1 || lyricsAdjElapsed < lyricsLines[i + 1]!.timeSec);
    // Playback position moves forward almost always, so start the search from the last
    // known index instead of rescanning the whole lyrics file on every 200ms tick.
    const last = activeLyricIndexRef.current;
    if (last >= 0 && last < lyricsLines.length && isMatch(last)) return last;
    if (last >= 0 && last < lyricsLines.length - 1 && isMatch(last + 1)) return last + 1;
    return lyricsLines.findIndex((_, i) => isMatch(i));
  }, [lyricsAdjElapsed, lyricsLines]);

  useEffect(() => {
    if (!lyricsLines) return;
    if (activeLyricIndex === activeLyricIndexRef.current) return;
    activeLyricIndexRef.current = activeLyricIndex;
    if (userScrollingRef.current) return;
    scrollToActiveLine();
  }, [activeLyricIndex, lyricsLines]);

  function handleLyricsScroll() {
    if (autoScrollingRef.current) return;
    userScrollingRef.current = true;
    setShowResyncPill(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      userScrollingRef.current = false;
      setShowResyncPill(false);
      scrollToActiveLine();
    }, 5000);
  }

  function handleResyncPress() {
    if (scrollTimeoutRef.current) { clearTimeout(scrollTimeoutRef.current); scrollTimeoutRef.current = null; }
    userScrollingRef.current = false;
    setShowResyncPill(false);
    scrollToActiveLine();
  }

  function handleLyricSeek(timeSec: number) {
    userScrollingRef.current = false;
    setShowResyncPill(false);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    onSeek(timeSec);
  }

  return (
    <>
      {lyricsSearchOpen && (
        <form
          className="lyrics-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (lyricsSearchArtist.trim() && lyricsSearchTitle.trim()) {
              setLyricsOverride({ artist: lyricsSearchArtist.trim(), title: lyricsSearchTitle.trim() });
            }
          }}
        >
          <input
            className="lyrics-search-input"
            placeholder="Artist"
            value={lyricsSearchArtist}
            onChange={(e) => setLyricsSearchArtist(e.target.value)}
          />
          <input
            className="lyrics-search-input"
            placeholder="Track title"
            value={lyricsSearchTitle}
            onChange={(e) => setLyricsSearchTitle(e.target.value)}
          />
          <div className="lyrics-search-actions">
            <button
              type="submit"
              className="lyrics-search-btn"
              disabled={!lyricsSearchArtist.trim() || !lyricsSearchTitle.trim()}
            >
              Search
            </button>
            {lyricsOverride && (
              <button
                type="button"
                className="lyrics-search-btn lyrics-search-btn--reset"
                onClick={() => {
                  setLyricsOverride(null);
                  setLyricsSearchArtist(currentTrackArtist ?? "");
                  setLyricsSearchTitle(currentTrackTitle ?? "");
                }}
              >
                Reset
              </button>
            )}
          </div>
        </form>
      )}
      <div className="now-playing-lyrics-wrap">
        <div
          className="now-playing-lyrics"
          ref={lyricsContainerRef}
          onScroll={handleLyricsScroll}
          onClick={(e) => {
            const target = (e.target as HTMLElement).closest<HTMLElement>("[data-lyric-index]");
            if (!target || !lyricsLines) return;
            const idx = Number(target.dataset.lyricIndex);
            const line = lyricsLines[idx];
            if (line) handleLyricSeek(line.timeSec + lyricsOffsetMs / 1000);
          }}
        >
          {lyricsLoading ? (
            <p className="now-playing-empty">Loading lyrics…</p>
          ) : lyricsLines && lyricsLines.length > 0 ? (
            lyricsLines.map((line, i) => (
              <LyricLine key={i} index={i} text={line.text} isActive={i === activeLyricIndex} />
            ))
          ) : lyricsPlain ? (
            <pre className="lyrics-plain">{lyricsPlain}</pre>
          ) : (
            <p className="now-playing-empty">No lyrics found.</p>
          )}
        </div>
        {showResyncPill && (
          <button className="lyrics-resync-pill" onClick={handleResyncPress}>
            <RefreshCw size={12} />
            Re-sync
          </button>
        )}
      </div>
    </>
  );
}

export function NowPlayingView({ serverWithCredential, onSelectAlbum, onSelectArtist, onStartRadio, onBack }: Props) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const volume = usePlayerStore((s) => s.volume);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const repeat = usePlayerStore((s) => s.repeat);
  const radioOnQueueEnd = usePlayerStore((s) => s.radioOnQueueEnd);
  const isShuffled = usePlayerStore((s) => s.isShuffled);
  const shuffleOrder = usePlayerStore((s) => s.shuffleOrder);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const next = usePlayerStore((s) => s.next);
  const error = usePlayerStore((s) => s.error);
  const retryCurrent = usePlayerStore((s) => s.retryCurrent);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleRepeat = usePlayerStore((s) => s.toggleRepeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const playFromQueueIndex = usePlayerStore((s) => s.playFromQueueIndex);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const moveQueueItem = usePlayerStore((s) => s.moveQueueItem);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const audioFormat = usePlayerStore((s) => s.audioFormat);
  const radioActive = usePlayerStore((s) => s.radioActive);
  const { lovedTrackIds, toggleTrackLove } = useLoved();
  const albumDisplayName = useAlbumDisplayName();
  const upNextRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("up-next");
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [lyricsSearchOpen, setLyricsSearchOpen] = useState(false);
  const [lyricsSearchArtist, setLyricsSearchArtist] = useState("");
  const [lyricsSearchTitle, setLyricsSearchTitle] = useState("");
  const [lyricsOverride, setLyricsOverride] = useState<LyricsOverride | null>(null);
  const [albumChipMenu, setAlbumChipMenu] = useState<{ x: number; y: number; album: AlbumRow } | null>(null);
  const [aboutTrackMenu, setAboutTrackMenu] = useState<{ x: number; y: number; track: TopTrack | SuggestedTrack } | null>(null);
  const [upNextMenu, setUpNextMenu] = useState<{ x: number; y: number; position: number } | null>(null);

  const { server, credential } = serverWithCredential;
  const duration = currentTrack?.duration ?? 0;
  const nextDisabled = isNextDisabled(repeat, queueIndex, queue.length, radioOnQueueEnd);
  const isLoved = currentTrack ? lovedTrackIds.has(currentTrack.id) : false;
  const repeatLabel = repeatModeLabel(repeat);
  const shuffleLabel = isShuffled ? "Shuffle on" : "Shuffle off";

  const primaryArtist = currentTrack?.artist
    ? (currentTrack.artist.match(/^(.+?)\s+(?:feat\.|ft\.|featuring)\s+/i)?.[1] ?? currentTrack.artist)
    : null;
  const { data: artistAlbums } = useArtistAlbums(primaryArtist);
  const { data: topTracks } = useArtistTopTracks(primaryArtist);
  const { data: suggestedTracks } = useSuggestedTracks(
    primaryArtist,
    currentTrack?.id ?? null
  );
  const { plain: lyricsPlain, synced: lyricsSynced, loading: lyricsLoading, refresh: lyricsRefresh, offsetMs: lyricsOffsetMs, setOffsetMs: setLyricsOffsetMs } = useLyrics(currentTrack ?? null, lyricsOverride, serverWithCredential);
  const lyricsLines = useMemo(() => (lyricsSynced ? parseLrc(lyricsSynced) : null), [lyricsSynced]);
  const accent = usePlayerStore((s) => s.accentColor);
  const waveformPeaks = usePlayerStore((s) => s.waveformPeaks);
  const [showWaveform] = useBoolSetting("player.show_waveform", true);
  const useWaveform = showWaveform && waveformPeaks && waveformPeaks.length > 0;
  const [bandsintownEnabled, setBandsintownEnabled] = useBoolSetting("enrichment.bandsintown_enabled", false);
  const [tourEvents, setTourEvents] = useState<BandsintownEvent[]>([]);
  const [tourLoading, setTourLoading] = useState(false);
  useEffect(() => {
    if (!bandsintownEnabled || !primaryArtist) {
      setTourEvents([]);
      setTourLoading(false);
      return;
    }
    let cancelled = false;
    setTourLoading(true);
    fetchBandsintownEvents(primaryArtist).then((events) => {
      if (!cancelled) {
        setTourEvents(events);
        setTourLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setTourLoading(false);
    });
    return () => { cancelled = true; };
  }, [bandsintownEnabled, primaryArtist]);

  // Downsample to 80 bars for the overlay, reduces DOM nodes from 200 and cuts jank.
  // Also quantize filledCount so WaveformBars only re-renders when the fill boundary moves.
  const overlayPeaks = useMemo(() => {
    if (!waveformPeaks) return null;
    const TARGET = 80;
    if (waveformPeaks.length <= TARGET) return waveformPeaks;
    const ratio = waveformPeaks.length / TARGET;
    return Array.from({ length: TARGET }, (_, i) => {
      const start = Math.floor(i * ratio);
      const end = Math.floor((i + 1) * ratio);
      let sum = 0;
      for (let j = start; j < end; j++) sum += waveformPeaks[j] ?? 0;
      return sum / (end - start);
    });
  }, [waveformPeaks]);

  const largeArtUrl = currentTrack?.artworkRef
    ? getCoverArtUrl(server.url, server.username, credential, currentTrack.artworkRef, 600)
    : currentTrack?.coverArtUrl ?? null;
  // Blur destroys detail anyway, so the full-viewport blurred backdrop only needs a
  // tiny source image (avoids WebKit running its expensive blur filter over 600px
  // of pixels it's about to throw away).
  const blurArtUrl = currentTrack?.artworkRef
    ? getCoverArtUrl(server.url, server.username, credential, currentTrack.artworkRef, 64)
    : currentTrack?.coverArtUrl ?? null;

  const [blurBg, setBlurBg] = useState<string | null>(null);
  useEffect(() => {
    setBlurBg(null);
    if (!blurArtUrl) return;
    let cancelled = false;
    void getBlurredBackdrop(blurArtUrl).then((dataUrl) => {
      if (!cancelled) setBlurBg(dataUrl);
    });
    return () => { cancelled = true; };
  }, [blurArtUrl]);

  const orderedTracks = useMemo(
    () => Array.from({ length: queue.length }, (_, pos) => {
      const idx = isShuffled && shuffleOrder.length > 0 ? (shuffleOrder[pos] ?? pos) : pos;
      return { position: pos, track: queue[idx] };
    }).filter((row): row is { position: number; track: CurrentTrack } => row.track != null),
    [queue, isShuffled, shuffleOrder]
  );

  const otherAlbums = useMemo(
    () => artistAlbums?.filter((a) => a.id !== currentTrack?.albumId) ?? [],
    [artistAlbums, currentTrack?.albumId]
  );

  useEffect(() => {
    setLyricsOverride(null);
    setLyricsSearchOpen(false);
    setLyricsSearchArtist(currentTrack?.artist ?? "");
    setLyricsSearchTitle(currentTrack?.title ?? "");
  }, [currentTrack?.id]);

  useEffect(() => {
    if (tab !== "up-next" || !upNextRef.current) return;
    const active = upNextRef.current.querySelector(".now-playing-up-next-row--active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }, [tab]);

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
    const streamUrlFn = (ct: CurrentTrack) =>
      getStreamUrl(server.url, server.username, credential, stripServerPrefix(ct.id, server.id));
    playNext(track, streamUrlFn);
    void next();
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


  return (
    <>
    <div
      className="now-playing-view"
      style={{
        ...(blurBg ? { '--art-bg': `url("${blurBg}")` } : {}),
        ...(accent ? { '--np-dominant': accent } : {}),
      } as React.CSSProperties}
    >
      {onBack && (
        <button className="now-playing-back-btn player-btn player-btn--icon" onClick={onBack} title="Back">
          <ChevronLeft size={22} />
        </button>
      )}
      <div className="now-playing-main">
        {/* ── Left: art + chrome ── */}
        <div className="now-playing-left">
          {largeArtUrl ? (
            <AlbumArt
              src={largeArtUrl}
              artist={currentTrack.artist}
              album={currentTrack.album ?? null}
              alt={currentTrack.title}
              className="now-playing-art"
            />
          ) : (
            <div className="now-playing-art now-playing-art--placeholder" />
          )}

          <div className="now-playing-info">
            <div className="now-playing-title-row">
              <p className="now-playing-title">{currentTrack.title}</p>
            </div>
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
              currentTrack.albumId ? (
                <button
                  className="now-playing-album now-playing-album--link"
                  onClick={() => onSelectAlbum({
                    id: currentTrack.albumId!,
                    server_id: serverWithCredential.server.id,
                    name: currentTrack.album!,
                    artist: currentTrack.artist ?? null,
                    year: null,
                    artwork_url: currentTrack.artworkRef ?? null,
                  })}
                >
                  {albumDisplayName(currentTrack.album!)}
                </button>
              ) : (
                <p className="now-playing-album">{albumDisplayName(currentTrack.album!)}</p>
              )
            )}
          </div>

          <NowPlayingProgress
            duration={duration}
            useWaveform={!!useWaveform}
            overlayPeaks={overlayPeaks}
          />

          {error && (
            <div className="now-playing-error" role="alert">
              <AlertCircle size={15} className="now-playing-error-icon" aria-hidden="true" />
              <span className="now-playing-error-msg">{error}</span>
              <button className="player-error-action" onClick={retryCurrent}>Retry</button>
              <button className="player-error-action" onClick={() => void next()} disabled={nextDisabled}>Skip</button>
            </div>
          )}

          {radioActive && (
            <div className="now-playing-radio-chip-row">
              <RadioChip />
            </div>
          )}

          {audioFormat && (
            <div className="now-playing-format">
              {audioFormat.codec && `${audioFormat.codec} · `}
              {audioFormat.sampleRate >= 1000
                ? `${(audioFormat.sampleRate / 1000).toFixed(1)} kHz`
                : `${audioFormat.sampleRate} Hz`}
              {" · "}
              {audioFormat.channels === 1 ? "mono" : audioFormat.channels === 2 ? "stereo" : `${audioFormat.channels}ch`}
            </div>
          )}

          <div className="now-playing-controls">
            <button
              className={`player-btn player-btn--icon${isShuffled ? " player-btn--active" : ""}`}
              onClick={toggleShuffle}
              title={shuffleLabel}
              aria-label={shuffleLabel}
              aria-pressed={isShuffled}
            >
              <Shuffle size={18} />
            </button>
            <button
              className="player-btn"
              onClick={() => void prev()}
              disabled={queue.length === 0}
              aria-label="Previous"
            >
              <SkipBack size={26} />
            </button>
            <button
              className="player-btn player-btn--play player-btn--play-large"
              onClick={isPlaying ? pause : resume}
              disabled={isLoading}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isLoading
                ? <Loader size={24} className="player-spin" />
                : isPlaying
                  ? <Pause size={24} fill="currentColor" strokeWidth={0} />
                  : <Play size={24} fill="currentColor" strokeWidth={0} />}
            </button>
            <button
              className="player-btn"
              onClick={() => void next()}
              disabled={nextDisabled}
              aria-label="Next"
            >
              <SkipForward size={26} />
            </button>
            <button
              className={`player-btn player-btn--icon${repeat !== "off" ? " player-btn--active" : ""}`}
              onClick={() => void toggleRepeat()}
              title={repeatLabel}
              aria-label={repeatLabel}
              aria-pressed={repeat !== "off"}
            >
              {repeat === "repeat-one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>
          </div>

          <div className="now-playing-extras">
            <div className="now-playing-extras-side"></div>
            <div className="now-playing-extras-center">
              <button
                className={`player-btn player-btn--icon now-playing-love-btn${isLoved ? " player-btn--active" : ""}`}
                onClick={() => void toggleTrackLove(currentTrack.id, serverWithCredential)}
                title={isLoved ? "Unlove" : "Love"}
                aria-label={isLoved ? "Unlove" : "Love"}
              >
                <Heart size={22} fill={isLoved ? "currentColor" : "none"} strokeWidth={isLoved ? 0 : 2} />
              </button>
              <div className="now-playing-volume-wrap">
                {volumeOpen && (
                  <div className="now-playing-volume-popover">
                    <input
                      type="range"
                      className="player-volume-slider now-playing-volume-slider"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(e) => void setVolume(parseFloat(e.target.value))}
                      onContextMenu={(e) => { e.preventDefault(); toggleMute(); }}
                      aria-label="Volume"
                    />
                  </div>
                )}
                <button
                  className={`player-btn player-btn--icon${volumeOpen ? " player-btn--active" : ""}`}
                  onClick={() => setVolumeOpen((o) => !o)}
                  onContextMenu={(e) => { e.preventDefault(); toggleMute(); }}
                  title="Volume"
                >
                  {volume > 0 ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </button>
              </div>
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
            {tab === "up-next" && queue.length > 0 && (
              <button
                className="now-playing-tab-refresh-btn"
                title="Clear queue"
                aria-label="Clear queue"
                onClick={() => clearQueue()}
              >
                <ListX size={14} />
              </button>
            )}
            {tab === "lyrics" && (
              <div className="now-playing-tab-lyric-actions">
                {lyricsLines && (
                  <div className="lyrics-offset-controls">
                    <button
                      className="now-playing-tab-refresh-btn"
                      title="Shift lyrics earlier (−500ms)"
                      style={{ margin: 0 }}
                      onClick={() => void setLyricsOffsetMs(lyricsOffsetMs - 500)}
                    >−</button>
                    {lyricsOffsetMs !== 0 && (
                      <button
                        className="lyrics-offset-value"
                        title="Reset offset"
                        onClick={() => void setLyricsOffsetMs(0)}
                      >
                        {lyricsOffsetMs > 0 ? "+" : ""}{(lyricsOffsetMs / 1000).toFixed(1)}s
                      </button>
                    )}
                    <button
                      className="now-playing-tab-refresh-btn"
                      title="Shift lyrics later (+500ms)"
                      style={{ margin: 0 }}
                      onClick={() => void setLyricsOffsetMs(lyricsOffsetMs + 500)}
                    >+</button>
                  </div>
                )}
                <button
                  className={`now-playing-tab-refresh-btn${lyricsSearchOpen ? " now-playing-tab-refresh-btn--active" : ""}`}
                  title="Search manually"
                  style={{ margin: 0 }}
                  onClick={() => setLyricsSearchOpen((o) => !o)}
                >
                  <span style={{ fontSize: 11 }}>A→Z</span>
                </button>
                <button
                  className="now-playing-tab-refresh-btn"
                  title="Re-fetch lyrics"
                  disabled={lyricsLoading}
                  style={{ margin: 0 }}
                  onClick={() => { setLyricsOverride(null); void lyricsRefresh(); }}
                >
                  <RefreshCw size={13} className={lyricsLoading ? "spin" : ""} />
                </button>
              </div>
            )}
          </div>

          <div className="now-playing-tab-panel" ref={tab === "up-next" ? upNextRef : undefined}>
            {tab === "up-next" && (
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
              </>
            )}

            {tab === "about" && (
              <>
                {otherAlbums.length > 0 && (
                  <div className="now-playing-more-section">
                    <h3 className="now-playing-section-title">More from {primaryArtist}</h3>
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
                            onContextMenu={(e) => { e.preventDefault(); setAlbumChipMenu({ x: e.clientX, y: e.clientY, album }); }}
                          >
                            {thumbUrl
                              ? <img src={thumbUrl} alt={album.name} className="now-playing-album-chip-art" />
                              : <div className="now-playing-album-chip-art now-playing-album-chip-art--placeholder" />
                            }
                            <span className="now-playing-album-chip-name">{albumDisplayName(album.name)}</span>
                            {album.year && <span className="now-playing-album-chip-year">{album.year}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {topTracks && topTracks.length > 0 && (
                  <div className="now-playing-more-section">
                    <h3 className="now-playing-section-title">Top tracks by {primaryArtist}</h3>
                    <div className="now-playing-top-tracks-grid">
                      {topTracks.slice(0, 10).map((track, i) => (
                        <div key={track.id} className="now-playing-track-row" onContextMenu={(e) => { e.preventDefault(); setAboutTrackMenu({ x: e.clientX, y: e.clientY, track }); }}>
                          {track.artwork_url
                            ? <img className="now-playing-track-thumb" src={getCoverArtUrl(server.url, server.username, credential, track.artwork_url, 64)} alt="" />
                            : <span className="now-playing-track-num">{i + 1}</span>}
                          <div className="now-playing-track-info">
                            <span className="now-playing-track-title">{track.title}</span>
                            {track.album_name && (
                              <span className="now-playing-track-album">{albumDisplayName(track.album_name, track.album_id ?? undefined)}</span>
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
                              <PlayCircle size={16} />
                            </button>
                            <button
                              className="now-playing-track-action-btn"
                              title="Play next"
                              onClick={(e) => { e.stopPropagation(); handlePlayNext(track); }}
                            >
                              <Play size={14} />
                            </button>
                            <button
                              className="now-playing-track-action-btn"
                              title="Add to queue"
                              onClick={(e) => { e.stopPropagation(); handleAddToQueue(track); }}
                            >
                              <ListEnd size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {suggestedTracks && suggestedTracks.length > 0 && (
                  <div className="now-playing-more-section">
                    <h3 className="now-playing-section-title">Suggested</h3>
                    <div className="now-playing-top-tracks-grid">
                      {suggestedTracks.slice(0, 10).map((track) => (
                        <div key={track.id} className="now-playing-track-row" onContextMenu={(e) => { e.preventDefault(); setAboutTrackMenu({ x: e.clientX, y: e.clientY, track }); }}>
                          {track.artwork_url
                            ? <img className="now-playing-track-thumb" src={getCoverArtUrl(server.url, server.username, credential, track.artwork_url, 64)} alt="" />
                            : <span className="now-playing-track-num" />}
                          <div className="now-playing-track-info">
                            <span className="now-playing-track-title">{track.title}</span>
                            <span className="now-playing-track-album">
                              {[track.artist, track.album_name ? albumDisplayName(track.album_name, track.album_id ?? undefined) : null].filter(Boolean).join(" - ")}
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
                              <PlayCircle size={16} />
                            </button>
                            <button
                              className="now-playing-track-action-btn"
                              title="Play next"
                              onClick={() => handlePlayNext(track)}
                            >
                              <Play size={14} />
                            </button>
                            <button
                              className="now-playing-track-action-btn"
                              title="Add to queue"
                              onClick={() => handleAddToQueue(track)}
                            >
                              <ListEnd size={16} />
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

                {primaryArtist && (
                  <TourCard
                    artistName={primaryArtist}
                    enabled={bandsintownEnabled}
                    loading={tourLoading}
                    events={tourEvents}
                    onEnable={() => void setBandsintownEnabled(true)}
                  />
                )}
              </>
            )}

            {tab === "lyrics" && (
              <LyricsTabPanel
                key={currentTrack?.id}
                lyricsLines={lyricsLines}
                lyricsPlain={lyricsPlain}
                lyricsLoading={lyricsLoading}
                lyricsOffsetMs={lyricsOffsetMs}
                lyricsSearchOpen={lyricsSearchOpen}
                lyricsSearchArtist={lyricsSearchArtist}
                lyricsSearchTitle={lyricsSearchTitle}
                setLyricsSearchArtist={setLyricsSearchArtist}
                setLyricsSearchTitle={setLyricsSearchTitle}
                lyricsOverride={lyricsOverride}
                setLyricsOverride={setLyricsOverride}
                currentTrackArtist={currentTrack?.artist ?? null}
                currentTrackTitle={currentTrack?.title ?? null}
                onSeek={(t) => void seek(t)}
              />
            )}
          </div>
        </div>
      </div>
    </div>

    {albumChipMenu && (
      <ContextMenu x={albumChipMenu.x} y={albumChipMenu.y} onClose={() => setAlbumChipMenu(null)}>
        <button onClick={() => { onSelectAlbum(albumChipMenu.album); setAlbumChipMenu(null); }}>Go to Album</button>
        <StartRadioSubmenu
          onSelect={(mode) => { onStartRadio(albumChipMenu.album, mode); setAlbumChipMenu(null); }}
        />
      </ContextMenu>
    )}

    {aboutTrackMenu && (
      <ContextMenu x={aboutTrackMenu.x} y={aboutTrackMenu.y} onClose={() => setAboutTrackMenu(null)}>
        <button onClick={() => { handlePlayTrack(aboutTrackMenu.track); setAboutTrackMenu(null); }}>Play now</button>
        <button onClick={() => { handlePlayNext(aboutTrackMenu.track); setAboutTrackMenu(null); }}>Play next</button>
        <button onClick={() => { handleAddToQueue(aboutTrackMenu.track); setAboutTrackMenu(null); }}>Add to queue</button>
        {aboutTrackMenu.track.album_id && (
          <button
            onClick={() => {
              onSelectAlbum({
                id: aboutTrackMenu.track.album_id!,
                server_id: server.id,
                name: aboutTrackMenu.track.album_name ?? "",
                artist: aboutTrackMenu.track.artist,
                year: null,
                artwork_url: aboutTrackMenu.track.artwork_url,
              });
              setAboutTrackMenu(null);
            }}
          >
            Go to Album
          </button>
        )}
        {onSelectArtist && aboutTrackMenu.track.artist && (
          <button
            onClick={() => { onSelectArtist(aboutTrackMenu.track.artist!); setAboutTrackMenu(null); }}
          >
            Go to Artist
          </button>
        )}
        {aboutTrackMenu.track.album_id && (
          <StartRadioSubmenu
            onSelect={(mode) => {
              onStartRadio(
                {
                  id: aboutTrackMenu.track.album_id!,
                  server_id: server.id,
                  name: aboutTrackMenu.track.album_name ?? "",
                  artist: aboutTrackMenu.track.artist,
                  year: null,
                  artwork_url: aboutTrackMenu.track.artwork_url,
                },
                mode
              );
              setAboutTrackMenu(null);
            }}
          />
        )}
      </ContextMenu>
    )}

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
        <StartRadioSubmenu
          onSelect={(mode) => {
            const entry = orderedTracks.find((t) => t.position === upNextMenu.position);
            if (entry) {
              void playFromQueueIndex(upNextMenu.position).then(() => {
                startRadio(entry.track, mode);
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
