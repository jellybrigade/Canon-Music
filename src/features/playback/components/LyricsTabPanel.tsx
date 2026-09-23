import React, { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { usePlayerStore } from "../store/player";
import { type LyricsOverride } from "../hooks/useLyrics";
import { type LrcLine } from "../../../clients/lrclib";
import "./LyricsTabPanel.css";

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
  return (
    <div
      data-lyric-index={index}
      className={`lyrics-line${isActive ? " lyrics-line--active" : ""}`}
    >
      {text || " "}
    </div>
  );
});

export function LyricsTabPanel({
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
