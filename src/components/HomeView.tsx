import { useMemo, useRef, useState, useEffect, useCallback, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { useClickOutside } from "../hooks/useClickOutside";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ListEnd, Play, Radio, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { CanonIcon } from "./CanonIcon";
import { useSetting } from "../hooks/useSetting";
import { useAlbumDisplayName } from "../hooks/useAlbumDisplayName";
import { getCoverArtUrl, getStreamUrl } from "../lib/navidrome";
import type { NavidromeAlbum } from "../lib/navidrome";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow, ArtistRow } from "../types/library";
import { useAlbums } from "../hooks/useAlbums";
import { useCarouselAlbums } from "../hooks/useCarouselAlbums";
import { useListeningStats } from "../hooks/useListeningStats";
import type { AlbumStatRow } from "../hooks/useListeningStats";
import { useLoved } from "../hooks/useLoved";
import { usePlayAlbum, useAddAlbumToQueue } from "../hooks/usePlayAlbum";
import { useRecommendedAlbum } from "../hooks/useRecommendedAlbum";
import { useRecentlyReleasedAlbums } from "../hooks/useRecentlyReleasedAlbums";
import { useRecentGenres } from "../hooks/useGenres";
import type { GenreRow } from "../hooks/useGenres";
import { usePlayerStore } from "../store/player";
import type { RadioMode, CurrentTrack } from "../store/player";
import { extractAccent } from "../lib/artColor";
import { useSearch } from "../hooks/useSearch";
import { getDb } from "../db";
import { stripServerPrefix } from "../utils/ids";
import { SearchResults } from "./SearchResults";
import { ContextMenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import { AlbumIdentifyDialog } from "./IdentifyDialog";
import "../styles/home.css";
import "../styles/genres.css";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  serverWithCredential: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist?: (name: string) => void;
  onStartRadio: (album: AlbumRow, mode: RadioMode) => void;
  onStartRadioFromArtist: (artist: ArtistRow, mode: RadioMode) => void;
  onPlayTrack: (trackId: string) => void;
  onOpenCommandPalette: () => void;
  homeSearchRaw: string;
  homeSearchQuery: string;
  onHomeSearchRawChange: (v: string) => void;
}

interface SpotlightPick {
  kicker: string;
  album: AlbumRow;
}

interface ForYouGroup {
  kicker: string;
  albums: AlbumRow[];
}

type ForYouCustomFilter =
  | { type: "decade"; decade: number }
  | { type: "artist"; artist: string };

interface ForYouCategoryConfig {
  key: string;
  kicker: string;
  enabled: boolean;
  customFilter?: ForYouCustomFilter;
}

const FOR_YOU_CATEGORIES: { key: string; kicker: string; desc: string }[] = [
  { key: "jump-back-in",     kicker: "Jump back in",     desc: "Recently played" },
  { key: "on-repeat",        kicker: "On repeat",        desc: "Played most in the last 30 days" },
  { key: "rediscover",       kicker: "Rediscover",       desc: "Favorites you haven't played recently" },
  { key: "finish-the-album", kicker: "Finish the album", desc: "Albums you've only partially heard" },
  { key: "hidden-gem",       kicker: "Hidden gem",       desc: "Albums with just 1–3 plays" },
  { key: "loved",            kicker: "Loved",            desc: "Albums and tracks you've starred" },
  { key: "unplayed",         kicker: "Unplayed",         desc: "Never played in your library" },
  { key: "almost-done",      kicker: "Almost done",      desc: "Albums where you've heard most but not all tracks" },
];

const DEFAULT_FOR_YOU_ENABLED = new Set([
  "jump-back-in", "on-repeat", "rediscover", "finish-the-album", "hidden-gem", "loved", "almost-done",
]);

const DEFAULT_FOR_YOU_CONFIG: ForYouCategoryConfig[] = FOR_YOU_CATEGORIES.map(c => ({
  ...c,
  enabled: DEFAULT_FOR_YOU_ENABLED.has(c.key),
}));

const DEFAULT_FOR_YOU_CONFIG_JSON = JSON.stringify(DEFAULT_FOR_YOU_CONFIG);

const FOR_YOU_CATEGORY_DESC: Record<string, string> = Object.fromEntries(
  FOR_YOU_CATEGORIES.map(c => [c.key, c.desc])
);

/** Merges a saved config with the canonical category list so newly-added categories
 *  always appear (appended, using their default enabled state). */
function mergeForYouConfig(saved: ForYouCategoryConfig[]): ForYouCategoryConfig[] {
  const savedKeys = new Set(saved.map(c => c.key));
  const added = FOR_YOU_CATEGORIES
    .filter(c => !savedKeys.has(c.key))
    .map(c => ({ ...c, enabled: DEFAULT_FOR_YOU_ENABLED.has(c.key) }));
  return [...saved, ...added];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function naviToAlbumRow(album: NavidromeAlbum, serverId: string): AlbumRow {
  return {
    id: `${serverId}:${album.id}`,
    server_id: serverId,
    name: album.name,
    artist: album.artist,
    year: album.year ?? null,
    artwork_url: album.coverArt ?? null,
  };
}


const FEAT_RE = /\s*\(?(?:feat\.?|ft\.?|featuring)\s+.*/i;

function stripFeaturedArtists(artist: string): string {
  return artist.replace(FEAT_RE, "").trim();
}

function buildSpotlight(
  currentArtist: string | null,
  currentAlbumId: string | null,
  onRepeat: AlbumStatRow[],
  rediscover: AlbumStatRow[],
  recentRaw: NavidromeAlbum[] | undefined,
  frequentRaw: NavidromeAlbum[] | undefined,
  allAlbums: AlbumRow[] | undefined,
  serverId: string,
  unplayedWithArt: AlbumRow[],
): SpotlightPick | null {
  if (currentArtist) {
    const displayArtist = stripFeaturedArtists(currentArtist);
    const fromStats =
      onRepeat.find(a => a.artist === currentArtist && a.id !== currentAlbumId) ??
      rediscover.find(a => a.artist === currentArtist && a.id !== currentAlbumId);
    if (fromStats) return { kicker: `More from ${displayArtist}`, album: fromStats };

    const fromFrequent = frequentRaw?.find(a => {
      const id = `${serverId}:${a.id}`;
      return a.artist === currentArtist && id !== currentAlbumId && !!a.coverArt;
    });
    if (fromFrequent) return { kicker: `More from ${displayArtist}`, album: naviToAlbumRow(fromFrequent, serverId) };

    const fromAlbums = allAlbums?.find(
      a => a.artist === currentArtist && a.id !== currentAlbumId && a.artwork_url
    );
    if (fromAlbums) return { kicker: `More from ${displayArtist}`, album: fromAlbums };
  }

  const recentNotCurrent = recentRaw?.find(a => `${serverId}:${a.id}` !== currentAlbumId);
  if (recentNotCurrent) return { kicker: "Jump back in", album: naviToAlbumRow(recentNotCurrent, serverId) };
  if (rediscover[0]) return { kicker: "Rediscover", album: rediscover[0] };
  if (onRepeat[0]) return { kicker: "On repeat", album: onRepeat[0] };

  if (unplayedWithArt.length > 0) {
    const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    const pick = unplayedWithArt[dayIndex % unplayedWithArt.length];
    if (pick) return { kicker: "Discover something new", album: pick };
  }

  return null;
}

// Deterministic Fisher-Yates shuffle using a seed. Same seed = same order.
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = (seed ^ 0xdeadbeef) >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    s = Math.imul(s ^ (s >>> 17), 0x45d9f3b) >>> 0;
    s = Math.imul(s ^ (s >>> 15), 0x45d9f3b) >>> 0;
    s = (s ^ (s >>> 16)) >>> 0;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function buildForYouGroups(
  spotlightId: string | null,
  sources: Record<string, AlbumRow[]>,
  config: ForYouCategoryConfig[],
  seed: number,
  perCategory = 4,
): ForYouGroup[] {
  const groups: ForYouGroup[] = [];
  const used = new Set<string>(spotlightId ? [spotlightId] : []);

  let catIdx = 0;
  const groupFrom = (kicker: string, source: AlbumRow[]) => {
    const withArt = source.filter(a => a.artwork_url);
    if (withArt.length === 0) { catIdx++; return; }
    // Shuffle with a per-category seed so different categories pick independently.
    const shuffled = seededShuffle(withArt, seed * 31 + catIdx);
    catIdx++;
    const albums: AlbumRow[] = [];
    for (const a of shuffled) {
      if (albums.length >= perCategory) break;
      if (used.has(a.id)) continue;
      used.add(a.id);
      albums.push(a);
    }
    if (albums.length > 0) groups.push({ kicker, albums });
  };

  for (const cat of config) {
    if (!cat.enabled) continue;
    const source = sources[cat.key] ?? [];
    groupFrom(cat.kicker, source);
  }

  return groups;
}

// ── Spotlight ─────────────────────────────────────────────────────────────────

interface SpotlightProps {
  pick: SpotlightPick;
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist?: (name: string) => void;
  playAlbum: (album: AlbumRow) => void;
  onAddToQueue?: (album: AlbumRow) => void;
  onCardContextMenu: (e: React.MouseEvent, album: AlbumRow) => void;
}

function Spotlight({ pick, serverWithCred, onSelectAlbum, onSelectArtist, playAlbum, onAddToQueue, onCardContextMenu }: SpotlightProps) {
  const { server, credential } = serverWithCred;
  const albumDisplayName = useAlbumDisplayName();
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const { data: genres } = useQuery({
    queryKey: QK.spotlightGenres(pick.album.id),
    queryFn: async () => {
      const db = await getDb();
      return db.select<{ name: string }[]>(
        "SELECT name FROM album_genres WHERE album_id = ? AND relation = 'direct' ORDER BY name LIMIT 3",
        [pick.album.id]
      );
    },
    staleTime: 5 * 60 * 1000,
  });

  const artUrl = pick.album.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, pick.album.artwork_url, 400)
    : null;

  useEffect(() => {
    if (!artUrl) { setAccentColor(null); return; }
    let cancelled = false;
    void extractAccent(artUrl).then(color => { if (!cancelled) setAccentColor(color); });
    return () => { cancelled = true; };
  }, [artUrl]);

  return (
    <section
      className="home-spotlight"
      style={(accentColor ? { "--spotlight-accent": accentColor } : {}) as React.CSSProperties}
    >
      <div className="home-spotlight__wash" />
      <div className="home-spotlight__rule" />
      <div
        className="home-spotlight__art-wrap"
        onContextMenu={(e) => onCardContextMenu(e, pick.album)}
      >
        {artUrl
          ? <img className="home-spotlight__art" src={artUrl} alt={pick.album.name} loading="lazy" />
          : <div className="home-spotlight__art home-spotlight__art--placeholder" />}
      </div>
      <div className="home-spotlight__body">
        <div className="home-spotlight__top">
          <span className="home-spotlight__kicker">{pick.kicker}</span>
          <h2 className="home-spotlight__title">{albumDisplayName(pick.album.name)}</h2>
          {(pick.album.artist || pick.album.year) && (
            <p className="home-spotlight__meta">
              {pick.album.artist && onSelectArtist ? (
                <button className="home-spotlight__artist-link" onClick={() => onSelectArtist(pick.album.artist!)}>
                  {pick.album.artist}
                </button>
              ) : pick.album.artist}
              {pick.album.artist && pick.album.year && " · "}
              {pick.album.year}
            </p>
          )}
        </div>
        {genres && genres.length > 0 && (
          <p className="home-spotlight__genres">
            {genres.map(g => g.name).join(" · ")}
          </p>
        )}
        <div className="home-spotlight__actions">
          <button className="home-spotlight__play" onClick={() => playAlbum(pick.album)}>
            <div><Play size={13} fill="currentColor" /></div>
            Play
          </button>
          {onAddToQueue && (
            <button className="home-spotlight__play" onClick={() => onAddToQueue(pick.album)}>
              <div><ListEnd size={13} /></div>
              Add to Queue
            </button>
          )}
          <button className="home-spotlight__open" onClick={() => onSelectAlbum(pick.album)}>
            Open
          </button>
        </div>
      </div>
    </section>
  );
}

// ── For You Rail ──────────────────────────────────────────────────────────────

interface ForYouRailProps {
  groups: ForYouGroup[];
  isLoading?: boolean;
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  playAlbum: (album: AlbumRow) => void;
  onRefresh: () => void;
  onStartRadio?: (album: AlbumRow) => void;
  onCardContextMenu: (e: React.MouseEvent, album: AlbumRow) => void;
  config: ForYouCategoryConfig[];
  onConfigChange: (config: ForYouCategoryConfig[]) => void;
}

// ── For You Customize Popup ───────────────────────────────────────────────────

const FOR_YOU_POPUP_WIDTH = 180;

interface ForYouCustomizePopupProps {
  config: ForYouCategoryConfig[];
  onConfigChange: (config: ForYouCategoryConfig[]) => void;
  position: { top: number; left: number };
  popupRef: RefObject<HTMLDivElement | null>;
}

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];

function ForYouCustomizePopup({ config, onConfigChange, position, popupRef }: ForYouCustomizePopupProps) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [addName, setAddName] = useState("");
  const [addFilterType, setAddFilterType] = useState<"decade" | "artist">("decade");
  const [addDecade, setAddDecade] = useState(1990);
  const [addArtist, setAddArtist] = useState("");

  function handleDragStart(e: React.DragEvent, index: number) {
    setDragFrom(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }
  function handleDragOver(e: React.DragEvent, rowIndex: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropAt(e.clientY < rect.top + rect.height / 2 ? rowIndex : rowIndex + 1);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (dragFrom !== null && dropAt !== null) {
      const effectiveSlot = dropAt > dragFrom ? dropAt - 1 : dropAt;
      if (effectiveSlot !== dragFrom) {
        const next = [...config];
        const [item] = next.splice(dragFrom, 1);
        next.splice(effectiveSlot, 0, item!);
        onConfigChange(next);
      }
    }
    setDragFrom(null);
    setDropAt(null);
  }
  function handleDragEnd() {
    setDragFrom(null);
    setDropAt(null);
  }
  function toggleEnabled(index: number) {
    onConfigChange(config.map((c, i) => i === index ? { ...c, enabled: !c.enabled } : c));
  }
  function removeCustom(key: string) {
    onConfigChange(config.filter(c => c.key !== key));
  }
  function submitAdd() {
    const name = addName.trim();
    if (!name) return;
    if (addFilterType === "artist" && !addArtist.trim()) return;
    const key = `custom-${Date.now()}`;
    const customFilter: ForYouCustomFilter =
      addFilterType === "decade"
        ? { type: "decade", decade: addDecade }
        : { type: "artist", artist: addArtist.trim() };
    const next: ForYouCategoryConfig = { key, kicker: name, enabled: true, customFilter };
    onConfigChange([...config, next]);
    setAddMode(false);
    setAddName("");
    setAddArtist("");
  }

  return createPortal(
    <div
      ref={popupRef}
      className="for-you-popup"
      style={{ top: position.top, left: position.left }}
      onMouseDown={e => e.stopPropagation()}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
      }}
    >
      {addMode ? (
        <>
          <p className="for-you-popup__title">Add category</p>
          <div className="for-you-popup__add-form">
            <input
              className="for-you-popup__add-input"
              placeholder="Category name…"
              value={addName}
              onChange={e => setAddName(e.target.value)}
              autoFocus
            />
            <select className="for-you-popup__add-select" value={addFilterType} onChange={e => setAddFilterType(e.target.value as "decade" | "artist")}>
              <option value="decade">Decade</option>
              <option value="artist">Artist</option>
            </select>
            {addFilterType === "decade" && (
              <select className="for-you-popup__add-select" value={addDecade} onChange={e => setAddDecade(Number(e.target.value))}>
                {DECADES.map(d => <option key={d} value={d}>{d}s</option>)}
              </select>
            )}
            {addFilterType === "artist" && (
              <input
                className="for-you-popup__add-input"
                placeholder="Artist name…"
                value={addArtist}
                onChange={e => setAddArtist(e.target.value)}
              />
            )}
            <div className="for-you-popup__add-actions">
              <button className="for-you-popup__add-confirm" onClick={submitAdd}>Add</button>
              <button className="for-you-popup__add-cancel" onClick={() => { setAddMode(false); setAddName(""); setAddArtist(""); }}>Cancel</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="for-you-popup__title">Customize</p>
          {config.map((cat, i) => (
            <div key={cat.key}>
              {dropAt === i && <div className="for-you-popup__drop-line" />}
              <div
                className="for-you-popup__row"
                onDragOver={e => handleDragOver(e, i)}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
              >
                <span
                  className="for-you-popup__drag-handle"
                  aria-hidden="true"
                  draggable={!cat.customFilter}
                  onDragStart={cat.customFilter ? undefined : e => handleDragStart(e, i)}
                  style={{ visibility: cat.customFilter ? "hidden" : undefined }}
                >⠿</span>
                <input
                  type="checkbox"
                  id={`fycat-${cat.key}`}
                  checked={cat.enabled}
                  onChange={() => toggleEnabled(i)}
                  className="for-you-popup__checkbox"
                />
                <label htmlFor={`fycat-${cat.key}`} className="for-you-popup__label">
                  {cat.kicker}
                  {cat.customFilter ? (
                    <span className="for-you-popup__label-desc">
                      {cat.customFilter.type === "decade" ? `${cat.customFilter.decade}s` : `Artist: ${cat.customFilter.artist}`}
                    </span>
                  ) : (
                    <span className="for-you-popup__label-desc">{FOR_YOU_CATEGORY_DESC[cat.key]}</span>
                  )}
                </label>
                {cat.customFilter && (
                  <button className="for-you-popup__remove" onClick={() => removeCustom(cat.key)} aria-label="Remove category">×</button>
                )}
              </div>
            </div>
          ))}
          {dropAt === config.length && <div className="for-you-popup__drop-line" />}
          <button className="for-you-popup__add-btn" onClick={() => setAddMode(true)}>+ Add category</button>
        </>
      )}
    </div>,
    document.body,
  );
}

const KICKER_COLORS: Record<string, string> = {
  "Jump back in":     "#3b82f6",
  "On repeat":        "#6366f1",
  "Rediscover":       "#f59e0b",
  "Finish the album": "#14b8a6",
  "Hidden gem":       "#a855f7",
  "Loved":            "#ec4899",
  "Unplayed":                "#64748b",
  "More from":               "#f43f5e",
  "Discover something new":  "#10b981",
  _default:           "#6b7280",
};

function ForYouRail({ groups, isLoading, serverWithCred, onSelectAlbum, playAlbum, onRefresh, onStartRadio, onCardContextMenu, config, onConfigChange }: ForYouRailProps) {
  const { server, credential } = serverWithCred;
  const albumDisplayName = useAlbumDisplayName();
  const [showCustomize, setShowCustomize] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const customizeButtonRef = useRef<HTMLButtonElement>(null);

  const customizePopupRef = useRef<HTMLDivElement>(null);

  function handleCustomizeClick() {
    if (!showCustomize && customizeButtonRef.current) {
      const rect = customizeButtonRef.current.getBoundingClientRect();
      setPopupPos({
        top: rect.bottom + 6,
        left: rect.right - FOR_YOU_POPUP_WIDTH,
      });
    }
    setShowCustomize(s => !s);
  }

  useClickOutside([customizeButtonRef, customizePopupRef], () => setShowCustomize(false), showCustomize);

  if (groups.length === 0 && !isLoading) return null;
  if (groups.length === 0 && isLoading) {
    return (
      <section className="home-rail">
        <div className="home-rail__header">
          <p className="home-section-label" style={{ margin: 0 }}>For You</p>
        </div>
        <div className="home-suggestion-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="suggestion-card suggestion-card--skeleton suggestion-card--has-bottom">
              <div className="suggestion-card__header">
                <span className="suggestion-card__kicker-skel" />
              </div>
              <div className="suggestion-card__row suggestion-card__row--top">
                <div className="suggestion-card__tile"><div className="suggestion-card__art-wrap" /></div>
              </div>
              <div className="suggestion-card__row suggestion-card__row--bottom">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="suggestion-card__tile"><div className="suggestion-card__art-wrap" /></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="home-rail">
      <div className="home-rail__header">
        <p className="home-section-label" style={{ margin: 0 }}>For You</p>
        {onStartRadio && groups[0]?.albums[0] && (
          <button className="home-section__radio-btn" onClick={() => onStartRadio(groups[0]!.albums[0]!)} aria-label="Start For You radio" title="Start radio">
            <Radio size={13} />
          </button>
        )}
        <button className="home-rail__refresh" onClick={onRefresh} aria-label="Refresh suggestions">
          <RefreshCw size={11} />
        </button>
        <button
          ref={customizeButtonRef}
          className={`home-rail__customize${showCustomize ? " home-rail__customize--active" : ""}`}
          onClick={handleCustomizeClick}
          aria-label="Customize For You categories"
        >
          <SlidersHorizontal size={11} />
        </button>
        {showCustomize && (
          <ForYouCustomizePopup config={config} onConfigChange={onConfigChange} position={popupPos} popupRef={customizePopupRef} />
        )}
      </div>
      <div className="home-suggestion-grid">
        {groups.map(group => {
          const kickerColor = KICKER_COLORS[group.kicker]
            ?? (group.kicker.startsWith("More from") ? KICKER_COLORS["More from"] : undefined)
            ?? KICKER_COLORS._default;
          return (
            <div
              key={group.kicker}
              className={`suggestion-card${group.albums.length > 1 ? " suggestion-card--has-bottom" : ""}`}
              style={{ "--kicker-color": kickerColor } as React.CSSProperties}
            >
              <div className="suggestion-card__header">
                <span className="suggestion-card__kicker">{group.kicker}</span>
              </div>
              {/* Top row — 1 large tile */}
              <div className="suggestion-card__row suggestion-card__row--top">
                {group.albums.slice(0, 1).map(album => {
                  const artUrl = getCoverArtUrl(server.url, server.username, credential, album.artwork_url!, 300);
                  return (
                    <div
                      key={album.id}
                      className="suggestion-card__tile"
                      onClick={() => onSelectAlbum(album)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === "Enter" && onSelectAlbum(album)}
                      onContextMenu={e => onCardContextMenu(e, album)}
                    >
                      <div className="suggestion-card__art-wrap">
                        <img className="suggestion-card__art" src={artUrl} alt={album.name} decoding="async" loading="lazy" />
                        <div className="album-overlay">
                          <span className="album-name">{albumDisplayName(album.name)}</span>
                          {album.artist && <span className="album-artist">{album.artist}</span>}
                        </div>
                        <button
                          className="suggestion-card__play"
                          onClick={e => { e.stopPropagation(); playAlbum(album); }}
                          aria-label={`Play ${album.name}`}
                        >
                          <Play size={13} fill="currentColor" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Bottom row — 3 smaller tiles */}
              {group.albums.length > 1 && (
                <div className="suggestion-card__row suggestion-card__row--bottom">
                  {group.albums.slice(1, 4).map(album => {
                    const artUrl = getCoverArtUrl(server.url, server.username, credential, album.artwork_url!, 300);
                    return (
                      <div
                        key={album.id}
                        className="suggestion-card__tile"
                        onClick={() => onSelectAlbum(album)}
                        role="button"
                        tabIndex={0}
                        title={album.artist ? `${album.name} · ${album.artist}` : album.name}
                        onKeyDown={e => e.key === "Enter" && onSelectAlbum(album)}
                        onContextMenu={e => onCardContextMenu(e, album)}
                      >
                        <div className="suggestion-card__art-wrap">
                          <img className="suggestion-card__art" src={artUrl} alt={album.name} decoding="async" loading="lazy" />
                          <button
                            className="suggestion-card__play suggestion-card__play--sm"
                            onClick={e => { e.stopPropagation(); playAlbum(album); }}
                            aria-label={`Play ${album.name}`}
                          >
                            <Play size={10} fill="currentColor" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Featured Genres ───────────────────────────────────────────────────────────

interface FeaturedGenresSectionProps {
  genres: GenreRow[];
  onPlayGenre: (canonicalId: string, label?: string) => void;
}

function FeaturedGenresSection({ genres, onPlayGenre }: FeaturedGenresSectionProps) {
  if (genres.length === 0) return null;
  return (
    <section className="home-section">
      <div className="home-section__header">
        <h2 className="home-section__title">Genres from recent plays</h2>
      </div>
      <div className="genre-card-grid">
        {genres.slice(0, 18).map(g => (
          <div
            key={g.canonical_id}
            className="genre-card"
            role="button"
            tabIndex={0}
            onClick={() => onPlayGenre(g.canonical_id, g.name)}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onPlayGenre(g.canonical_id, g.name)}
            aria-label={`Play ${g.name} radio`}
          >
            <span className="genre-card__name">{g.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Album Carousel ────────────────────────────────────────────────────────────

interface AlbumCarouselProps {
  title: string;
  subtitle?: string;
  items: AlbumRow[] | undefined;
  isLoading?: boolean;
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  playAlbum: (album: AlbumRow) => void;
  onCardContextMenu: (e: React.MouseEvent, album: AlbumRow) => void;
  onRadio?: () => void;
}

const CARD_WIDTH = 168 + 14;

function AlbumCarousel({ title, subtitle, items, isLoading, serverWithCred, onSelectAlbum, playAlbum, onCardContextMenu, onRadio }: AlbumCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { server, credential } = serverWithCred;
  const albumDisplayName = useAlbumDisplayName();

  if (!isLoading && (!items || items.length === 0)) return null;

  const scroll = (dir: "prev" | "next") => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "next" ? CARD_WIDTH * 3 : -CARD_WIDTH * 3, behavior: "smooth" });
  };

  const skeletons = Array.from({ length: 6 });

  return (
    <section className="home-section">
      <div className="home-section__header">
        <h2 className="home-section__title">{title}</h2>
        {subtitle && <p className="home-section__subtitle">{subtitle}</p>}
        {onRadio && (
          <button className="home-section__radio-btn" onClick={onRadio} aria-label={`Start ${title} radio`} title="Start radio">
            <Radio size={13} />
          </button>
        )}
      </div>
      <div className="album-carousel">
        <button className="album-carousel__arrow album-carousel__arrow--prev" onClick={() => scroll("prev")} aria-label="Scroll left">
          <ChevronLeft size={15} />
        </button>
        <div className="album-carousel__track" ref={trackRef}>
          {isLoading
            ? skeletons.map((_, i) => (
                <div key={i} className="carousel-card carousel-card--skeleton">
                  <div className="carousel-card__art-wrap" />
                  <p className="carousel-card__name">&nbsp;</p>
                  <p className="carousel-card__artist">&nbsp;</p>
                </div>
              ))
            : (items ?? []).map(item => {
                const artUrl = item.artwork_url
                  ? getCoverArtUrl(server.url, server.username, credential, item.artwork_url, 300)
                  : null;
                return (
                  <div
                    key={item.id}
                    className="carousel-card"
                    onClick={() => onSelectAlbum(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === "Enter" && onSelectAlbum(item)}
                    onContextMenu={e => onCardContextMenu(e, item)}
                  >
                    <div className="carousel-card__art-wrap">
                      {artUrl
                        ? <img className="carousel-card__art" src={artUrl} alt={item.name} decoding="async" loading="lazy" />
                        : <div className="carousel-card__art" />}
                      <button
                        className="carousel-card__play"
                        onClick={e => { e.stopPropagation(); void playAlbum(item); }}
                        aria-label={`Play ${item.name}`}
                      >
                        <Play size={13} fill="currentColor" />
                      </button>
                    </div>
                    <p className="carousel-card__name">{albumDisplayName(item.name, item.id)}</p>
                    {item.artist && <p className="carousel-card__artist">{item.artist}</p>}
                  </div>
                );
              })}
        </div>
        <button className="album-carousel__arrow album-carousel__arrow--next" onClick={() => scroll("next")} aria-label="Scroll right">
          <ChevronRight size={15} />
        </button>
      </div>
    </section>
  );
}

// ── HomeView ──────────────────────────────────────────────────────────────────

export function HomeView({ serverWithCredential, onSelectAlbum, onSelectArtist, onStartRadio, onStartRadioFromArtist, onPlayTrack, onOpenCommandPalette, homeSearchRaw, homeSearchQuery, onHomeSearchRawChange }: Props) {
  const { server, credential } = serverWithCredential;
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const playQueue = usePlayerStore(s => s.playQueue);
  const startRadio = usePlayerStore(s => s.startRadio);
  const playAlbum = usePlayAlbum(serverWithCredential);
  const [forYouSeed, setForYouSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const refreshForYou = useCallback(() => setForYouSeed(s => s + 1), []);

  const [rawCategoryConfig, setRawCategoryConfig] = useSetting("for_you_categories", DEFAULT_FOR_YOU_CONFIG_JSON);
  const categoryConfig = useMemo<ForYouCategoryConfig[]>(() => {
    try {
      const parsed = JSON.parse(rawCategoryConfig) as ForYouCategoryConfig[];
      if (!Array.isArray(parsed)) return DEFAULT_FOR_YOU_CONFIG;
      return mergeForYouConfig(parsed);
    } catch {
      return DEFAULT_FOR_YOU_CONFIG;
    }
  }, [rawCategoryConfig]);
  const handleForYouConfigChange = useCallback((config: ForYouCategoryConfig[]) => {
    void setRawCategoryConfig(JSON.stringify(config));
  }, [setRawCategoryConfig]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; album: AlbumRow } | null>(null);
  const [identifyAlbum, setIdentifyAlbum] = useState<AlbumRow | null>(null);
  const openCardContextMenu = useCallback((e: React.MouseEvent, album: AlbumRow) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, album });
  }, []);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const { data: searchResults } = useSearch(homeSearchQuery);

  const { data: recentRaw, isLoading: recentLoading } = useCarouselAlbums(serverWithCredential, "recent");
  const { data: frequentRaw } = useCarouselAlbums(serverWithCredential, "frequent");
  const { data: allAlbums, isLoading: allLoading } = useAlbums("recently_added");
  const { data: recentlyReleasedRaw } = useRecentlyReleasedAlbums();
  const { genres: recentGenres } = useRecentGenres();
  const { onRepeat, rediscover, vault, hiddenGem, finishTheAlbum, almostDone, playedAlbumIds, isLoading: statsLoading } = useListeningStats();
  const { lovedAlbumIds, lovedTrackAlbumIds } = useLoved();

  const recentItems = useMemo(
    () => recentRaw?.map(a => naviToAlbumRow(a, server.id)),
    [recentRaw, server.id]
  );

  const unplayedWithArt = useMemo(
    () => allAlbums?.filter(a => a.artwork_url && !playedAlbumIds.has(a.id)) ?? [],
    [allAlbums, playedAlbumIds]
  );

  const spotlight = useMemo(
    () => buildSpotlight(
      currentTrack?.artist ?? null,
      currentTrack?.albumId ?? null,
      onRepeat, rediscover, recentRaw, frequentRaw, allAlbums, server.id,
      unplayedWithArt,
    ),
    [currentTrack, onRepeat, rediscover, recentRaw, frequentRaw, allAlbums, server.id, unplayedWithArt]
  );

  const currentAlbumId = currentTrack?.albumId ?? null;
  const { data: recommendedAlbum } = useRecommendedAlbum(currentAlbumId);

  const recommendedPick = useMemo<SpotlightPick | null>(() => {
    if (!currentTrack || !recommendedAlbum) return null;
    const album: AlbumRow = {
      id: recommendedAlbum.id,
      server_id: server.id,
      name: recommendedAlbum.name,
      artist: recommendedAlbum.artist,
      year: recommendedAlbum.year,
      artwork_url: recommendedAlbum.artwork_url,
    };
    const primaryArtist = currentTrack.artist
      ? stripFeaturedArtists(currentTrack.artist)
      : null;
    const kicker = primaryArtist
      ? `Because you're listening to ${primaryArtist}`
      : "You might also like";
    return { kicker, album };
  }, [currentTrack, recommendedAlbum, server.id]);

  const handleAddToQueue = useAddAlbumToQueue(serverWithCredential);

  const lovedItems = useMemo(
    () => allAlbums?.filter(a => lovedAlbumIds.has(a.id)),
    [allAlbums, lovedAlbumIds]
  );
  // Loved-sort fix: explicitly-loved albums come before track-only-loved albums
  const lovedSource = useMemo(() => {
    if (!allAlbums) return undefined;
    const seen = new Set<string>();
    const albumLoved: AlbumRow[] = [];
    const trackOnly: AlbumRow[] = [];
    for (const a of allAlbums) {
      if (seen.has(a.id)) continue;
      if (lovedAlbumIds.has(a.id)) {
        seen.add(a.id);
        albumLoved.push(a);
      } else if (lovedTrackAlbumIds.has(a.id)) {
        seen.add(a.id);
        trackOnly.push(a);
      }
    }
    return [...albumLoved, ...trackOnly];
  }, [allAlbums, lovedAlbumIds, lovedTrackAlbumIds]);


  const customCategorySources = useMemo<Record<string, AlbumRow[]>>(() => {
    const result: Record<string, AlbumRow[]> = {};
    if (!allAlbums) return result;
    for (const cat of categoryConfig) {
      if (!cat.customFilter) continue;
      const f = cat.customFilter;
      if (f.type === "decade") {
        result[cat.key] = allAlbums.filter(a => a.artwork_url && a.year != null && a.year >= f.decade && a.year < f.decade + 10);
      } else if (f.type === "artist") {
        const lower = f.artist.toLowerCase();
        result[cat.key] = allAlbums.filter(a => a.artwork_url && a.artist?.toLowerCase().includes(lower));
      }
    }
    return result;
  }, [allAlbums, categoryConfig]);

  const forYouSources = useMemo<Record<string, AlbumRow[]>>(() => ({
    "jump-back-in":     recentItems ?? [],
    "on-repeat":        onRepeat as AlbumRow[],
    "rediscover":       rediscover as AlbumRow[],
    "finish-the-album": finishTheAlbum as AlbumRow[],
    "hidden-gem":       hiddenGem as AlbumRow[],
    "loved":            lovedSource ?? [],
    "unplayed":         unplayedWithArt,
    "almost-done":      almostDone as AlbumRow[],
    ...customCategorySources,
  }), [recentItems, onRepeat, rediscover, finishTheAlbum, hiddenGem, lovedSource, unplayedWithArt, almostDone, customCategorySources]);

  const forYouGroups = useMemo(
    () => buildForYouGroups(spotlight?.album.id ?? null, forYouSources, categoryConfig, forYouSeed, 4),
    [spotlight, forYouSources, categoryConfig, forYouSeed]
  );
  const onRepeatItems = useMemo(() => onRepeat.slice(0, 20) as AlbumRow[], [onRepeat]);
  const newestItems = useMemo(() => allAlbums?.slice(0, 20), [allAlbums]);
  const vaultItems = useMemo(() => vault.slice(0, 20) as AlbumRow[], [vault]);

  const featuredGenres = recentGenres;

  const handlePlayGenre = useCallback(async (canonicalId: string, genreLabel?: string) => {
    const db = await getDb();
    type TrackRow = { id: string; title: string; artist: string | null; duration: number | null; album_id: string; artwork_url: string | null; album_name: string | null };
    const rows = await db.select<TrackRow[]>(
      `SELECT t.id, t.title, t.artist, t.duration, t.album_id, a.artwork_url, a.name AS album_name
       FROM tracks t
       JOIN albums a ON t.album_id = a.id
       JOIN album_genres ag ON a.id = ag.album_id
       WHERE ag.canonical_id = ? AND ag.relation = 'direct'
       ORDER BY RANDOM()
       LIMIT 1`,
      [canonicalId]
    );
    const t = rows[0];
    if (!t) return;
    const coverArtUrl = t.artwork_url
      ? getCoverArtUrl(server.url, server.username, credential, t.artwork_url, 64)
      : null;
    const track: CurrentTrack = {
      id: t.id, title: t.title, artist: t.artist, duration: t.duration,
      coverArtUrl, artworkRef: t.artwork_url ?? null, album: t.album_name ?? null, albumId: t.album_id,
    };
    const streamUrlFn = (tr: CurrentTrack) =>
      getStreamUrl(server.url, server.username, credential, stripServerPrefix(tr.id, server.id));
    await playQueue([track], streamUrlFn, 0);
    startRadio(track, "same-genre", genreLabel);
  }, [server, credential, playQueue, startRadio]);

  const play = (album: AlbumRow) => void playAlbum(album);

  const isSearching = homeSearchRaw.length > 0;

  return (
    <div className="home-view">
      <header className="home-greeting">
        <div className="home-greeting__left">
          <CanonIcon size={38} className="home-greeting__logo" />
          <h1 className="home-greeting__text">{getGreeting()}</h1>
        </div>
        <div className="home-search-bar">
          <Search size={13} className="search-bar-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="search-bar-input"
            placeholder="Search…"
            value={homeSearchRaw}
            onChange={(e) => onHomeSearchRawChange(e.target.value)}
          />
          {homeSearchRaw ? (
            <button className="search-bar-clear" onClick={() => onHomeSearchRawChange("")} title="Clear">
              <X size={13} />
            </button>
          ) : (
            <button className="home-search-palette-hint" onClick={onOpenCommandPalette} title="Command palette — search tracks, artists, albums, and navigate anywhere">
              <kbd>⌘K</kbd>
            </button>
          )}
        </div>
        {allAlbums != null && !isSearching && (
          <span className="home-greeting__sub">{allAlbums.length.toLocaleString()} albums</span>
        )}
      </header>

      {isSearching ? (
        searchResults && homeSearchQuery ? (
          <SearchResults
            albums={searchResults.albums}
            tracks={searchResults.tracks}
            artists={searchResults.artists}
            serverWithCredential={serverWithCredential}
            onSelectAlbum={onSelectAlbum}
            onSelectArtist={(artist) => { onHomeSearchRawChange(""); onSelectArtist?.(artist.name); }}
            onPlayTrack={onPlayTrack}
            onStartRadioFromAlbum={(album, mode) => onStartRadio(album, mode)}
            onStartRadioFromArtist={(artist, mode) => onStartRadioFromArtist(artist, mode)}
          />
        ) : (
          <p className="empty-state">Searching…</p>
        )
      ) : (
        <>
          {(recommendedPick ?? spotlight) && (
            <Spotlight
              pick={(recommendedPick ?? spotlight)!}
              serverWithCred={serverWithCredential}
              onSelectAlbum={onSelectAlbum}
              onSelectArtist={onSelectArtist}
              playAlbum={play}
              onAddToQueue={recommendedPick ? handleAddToQueue : undefined}
              onCardContextMenu={openCardContextMenu}
            />
          )}

          <FeaturedGenresSection genres={featuredGenres} onPlayGenre={handlePlayGenre} />

          <ForYouRail
            key={forYouSeed}
            groups={forYouGroups}
            isLoading={statsLoading || recentLoading || allLoading}
            serverWithCred={serverWithCredential}
            onSelectAlbum={onSelectAlbum}
            playAlbum={play}
            onRefresh={refreshForYou}
            onStartRadio={(album) => onStartRadio(album, "same-genre")}
            onCardContextMenu={openCardContextMenu}
            config={categoryConfig}
            onConfigChange={handleForYouConfigChange}
          />

          <AlbumCarousel title="Recently Played" subtitle="Where you left off" items={recentItems} isLoading={recentLoading} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} onRadio={() => { const a = recentItems?.[Math.floor(Math.random() * (recentItems?.length ?? 0))]; if (a) onStartRadio(a, "same-genre"); }} />
          <AlbumCarousel title="On Repeat" subtitle="Your most-played" items={onRepeatItems} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} onRadio={() => { const a = onRepeatItems?.[Math.floor(Math.random() * (onRepeatItems?.length ?? 0))]; if (a) onStartRadio(a, "same-genre"); }} />
          <AlbumCarousel title="Loved" subtitle="Starred albums" items={lovedItems} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} onRadio={() => { const a = lovedItems?.[Math.floor(Math.random() * (lovedItems?.length ?? 0))]; if (a) onStartRadio(a, "same-genre"); }} />
          <AlbumCarousel title="Newly Added" subtitle="Fresh arrivals" items={newestItems} isLoading={allLoading} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} onRadio={() => { const a = newestItems?.[Math.floor(Math.random() * (newestItems?.length ?? 0))]; if (a) onStartRadio(a, "same-genre"); }} />
          <AlbumCarousel title="Recently Released" subtitle="Sorted by release year" items={recentlyReleasedRaw} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} onRadio={() => { const a = recentlyReleasedRaw?.[Math.floor(Math.random() * (recentlyReleasedRaw?.length ?? 0))]; if (a) onStartRadio(a, "same-genre"); }} />
          <AlbumCarousel title="From the Vault" subtitle="Long-forgotten listens" items={vaultItems} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} onRadio={() => { const a = vaultItems?.[Math.floor(Math.random() * (vaultItems?.length ?? 0))]; if (a) onStartRadio(a, "same-genre"); }} />
        </>
      )}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <button onClick={() => { onSelectAlbum(contextMenu.album); setContextMenu(null); }}>
            Open album
          </button>
          <StartRadioSubmenu
            onSelect={(mode) => { onStartRadio(contextMenu.album, mode); setContextMenu(null); }}
          />
          <button onClick={() => { setIdentifyAlbum(contextMenu.album); setContextMenu(null); }}>
            Identify on MusicBrainz…
          </button>
        </ContextMenu>
      )}
      {identifyAlbum && (
        <AlbumIdentifyDialog
          albumId={identifyAlbum.id}
          artist={identifyAlbum.artist ?? ""}
          album={identifyAlbum.name}
          onClose={() => setIdentifyAlbum(null)}
        />
      )}
    </div>
  );
}
