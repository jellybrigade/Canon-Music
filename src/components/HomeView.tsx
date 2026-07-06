import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, ListEnd, Lock, Play, Plus, Radio, RefreshCw, Search, Unlock, X } from "lucide-react";
import { CanonIcon } from "./CanonIcon";
import { useSetting } from "../hooks/useSetting";
import { useAlbumDisplayName } from "../hooks/useAlbumDisplayName";
import { getCoverArtUrl, getStreamUrl } from "../lib/navidrome";
import type { NavidromeAlbum } from "../lib/navidrome";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow, ArtistRow } from "../types/library";
import { useAlbums } from "../hooks/useAlbums";
import { useAlbumCoverMap } from "../hooks/useCoverCache";
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
import { useSearch } from "../hooks/useSearch";
import { getDb } from "../db";
import { stripServerPrefix } from "../utils/ids";
import { SearchResults } from "./SearchResults";
import { ContextMenu, ContextMenuSubmenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import { usePlaylists } from "../hooks/usePlaylists";
import { AlbumIdentifyDialog } from "./IdentifyDialog";
import { extractAccent } from "../lib/artColor";
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
  { key: "hidden-gem",       kicker: "Hidden gem",       desc: "Albums with just 1-3 plays" },
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

// Returns candidate picks in priority order (not deduped), caller dedupes by album id.
function buildSpotlightCandidates(
  currentArtist: string | null,
  currentAlbumId: string | null,
  onRepeat: AlbumStatRow[],
  rediscover: AlbumStatRow[],
  recentRaw: NavidromeAlbum[] | undefined,
  frequentRaw: NavidromeAlbum[] | undefined,
  allAlbums: AlbumRow[] | undefined,
  serverId: string,
  unplayedWithArt: AlbumRow[],
): SpotlightPick[] {
  const picks: SpotlightPick[] = [];

  if (currentArtist) {
    const displayArtist = stripFeaturedArtists(currentArtist);
    const fromStats =
      onRepeat.find(a => a.artist === currentArtist && a.id !== currentAlbumId) ??
      rediscover.find(a => a.artist === currentArtist && a.id !== currentAlbumId);
    const fromFrequent = frequentRaw?.find(a => {
      const id = `${serverId}:${a.id}`;
      return a.artist === currentArtist && id !== currentAlbumId && !!a.coverArt;
    });
    const fromAlbums = allAlbums?.find(
      a => a.artist === currentArtist && a.id !== currentAlbumId && a.artwork_url
    );
    const fromArtist = fromStats
      ?? (fromFrequent ? naviToAlbumRow(fromFrequent, serverId) : undefined)
      ?? fromAlbums;
    if (fromArtist) picks.push({ kicker: `More from ${displayArtist}`, album: fromArtist });
  }

  const recentNotCurrent = recentRaw?.find(a => `${serverId}:${a.id}` !== currentAlbumId);
  if (recentNotCurrent) picks.push({ kicker: "Jump back in", album: naviToAlbumRow(recentNotCurrent, serverId) });
  if (rediscover[0]) picks.push({ kicker: "Rediscover", album: rediscover[0] });
  if (onRepeat[0]) picks.push({ kicker: "On repeat", album: onRepeat[0] });

  if (unplayedWithArt.length > 0) {
    const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    for (let i = 0; i < 3; i++) {
      const pick = unplayedWithArt[(dayIndex + i) % unplayedWithArt.length];
      if (pick) picks.push({ kicker: "Discover something new", album: pick });
    }
  }

  return picks;
}

function dedupePicks(candidates: SpotlightPick[], max: number): SpotlightPick[] {
  const seen = new Set<string>();
  const picks: SpotlightPick[] = [];
  for (const c of candidates) {
    if (seen.has(c.album.id)) continue;
    seen.add(c.album.id);
    picks.push(c);
    if (picks.length >= max) break;
  }
  return picks;
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
  spotlightIds: string[],
  sources: Record<string, AlbumRow[]>,
  config: ForYouCategoryConfig[],
  seed: number,
  perCategory = 4,
): ForYouGroup[] {
  const groups: ForYouGroup[] = [];
  const used = new Set<string>(spotlightIds);

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
  primary?: boolean;
}

function Spotlight({ pick, serverWithCred, onSelectAlbum, onSelectArtist, playAlbum, onAddToQueue, onCardContextMenu, primary }: SpotlightProps) {
  const { server, credential } = serverWithCred;
  const albumDisplayName = useAlbumDisplayName();
  const coverMap = useAlbumCoverMap();

  const artUrl = coverMap.get(pick.album.id)
    ?? (pick.album.artwork_url
      ? getCoverArtUrl(server.url, server.username, credential, pick.album.artwork_url, primary ? 400 : 200)
      : null);

  const [accentColor, setAccentColor] = useState<string | null>(pick.album.accent_color ?? null);
  useEffect(() => {
    if (pick.album.accent_color) {
      setAccentColor(pick.album.accent_color);
      return;
    }
    setAccentColor(null);
    if (!artUrl) return;
    let cancelled = false;
    void extractAccent(artUrl).then(async (color) => {
      if (cancelled) return;
      setAccentColor(color);
      if (color) {
        const db = await getDb();
        await db.execute(`UPDATE albums SET accent_color = ? WHERE id = ?`, [color, pick.album.id]);
      }
    });
    return () => { cancelled = true; };
  }, [artUrl, pick.album.accent_color, pick.album.id]);

  return (
    <section
      className={primary ? "home-spotlight home-spotlight--primary" : "home-spotlight"}
      style={accentColor ? ({ "--spotlight-accent": accentColor } as React.CSSProperties) : undefined}
    >
      <button
        type="button"
        className="home-spotlight__art-wrap"
        onClick={() => playAlbum(pick.album)}
        onContextMenu={(e) => onCardContextMenu(e, pick.album)}
        title="Play"
        aria-label={`Play ${pick.album.name}`}
      >
        {artUrl
          ? <img className="home-spotlight__art" src={artUrl} alt={pick.album.name} loading="lazy" />
          : <div className="home-spotlight__art home-spotlight__art--placeholder" />}
        <span className="home-spotlight__art-play">
          <Play size={primary ? 28 : 18} fill="currentColor" />
        </span>
      </button>
      <div className="home-spotlight__text">
        <p className="home-spotlight__kicker">{pick.kicker}</p>
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
        {primary && (
          <div className="home-spotlight__cta">
            <button
              className="home-spotlight__play-btn"
              onClick={() => playAlbum(pick.album)}
            >
              <Play size={14} fill="currentColor" /> Play
            </button>
            {onAddToQueue && (
              <button
                className="home-spotlight__queue-btn"
                onClick={() => onAddToQueue(pick.album)}
              >
                <ListEnd size={14} /> Add to Queue
              </button>
            )}
            <button
              className="home-spotlight__open-btn"
              onClick={() => onSelectAlbum(pick.album)}
            >
              Open
            </button>
          </div>
        )}
      </div>
      {!primary && (
        <div className="home-spotlight__actions">
          <button
            className="home-spotlight__play-icon"
            onClick={() => playAlbum(pick.album)}
            title="Play"
            aria-label={`Play ${pick.album.name}`}
          >
            <Play size={16} fill="currentColor" />
          </button>
          <button
            className="home-spotlight__open"
            onClick={() => onSelectAlbum(pick.album)}
            title="Open"
            aria-label="Open"
          >
            <ArrowUpRight size={16} />
          </button>
          {onAddToQueue && (
            <button
              className="home-spotlight__open"
              onClick={() => onAddToQueue(pick.album)}
              title="Add to Queue"
              aria-label="Add to Queue"
            >
              <ListEnd size={16} />
            </button>
          )}
        </div>
      )}
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

function ForYouRail({ groups, isLoading, serverWithCred, onSelectAlbum, playAlbum, onRefresh, onStartRadio, onCardContextMenu, config, onConfigChange }: ForYouRailProps) {
  const { server, credential } = serverWithCred;
  const albumDisplayName = useAlbumDisplayName();
  const coverMap = useAlbumCoverMap();
  const descByKicker = useMemo(() => {
    const map: Record<string, string> = {};
    for (const cat of config) {
      if (cat.customFilter) {
        map[cat.kicker] = cat.customFilter.type === "decade"
          ? `Albums from the ${cat.customFilter.decade}s`
          : `Albums by ${cat.customFilter.artist}`;
      } else if (FOR_YOU_CATEGORY_DESC[cat.key]) {
        map[cat.kicker] = FOR_YOU_CATEGORY_DESC[cat.key]!;
      }
    }
    return map;
  }, [config]);
  const [activeTabKicker, setActiveTabKicker] = useState<string | null>(null);
  const [locked, setLocked] = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [addType, setAddType] = useState<"decade" | "artist">("decade");
  const [addDecade, setAddDecade] = useState("");
  const [addArtist, setAddArtist] = useState("");

  if (groups.length === 0 && !isLoading) return null;
  if (groups.length === 0 && isLoading) {
    return (
      <section className="home-rail">
        <div className="home-rail__header">
          <p className="home-section-label" style={{ margin: 0 }}>For You</p>
        </div>
        <div className="foryou-v2-tabs">
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className="foryou-v2-tab-skel" />
          ))}
        </div>
        <div className="foryou-v2-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="foryou-v2-tile">
              <div className="foryou-v2-tile__art-wrap foryou-v2-tile__art-wrap--skeleton" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  const activeTabGroup = groups.find(g => g.kicker === activeTabKicker) ?? groups[0]!;

  function handleTabKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? (index + 1) % groups.length : (index - 1 + groups.length) % groups.length;
    setActiveTabKicker(groups[next]!.kicker);
  }

  function reorderConfig(fromIndex: number, toIndex: number) {
    const effectiveSlot = toIndex > fromIndex ? toIndex - 1 : toIndex;
    if (effectiveSlot === fromIndex) return;
    const next = [...config];
    const [item] = next.splice(fromIndex, 1);
    next.splice(effectiveSlot, 0, item!);
    onConfigChange(next);
  }

  function toggleEnabled(kicker: string) {
    onConfigChange(config.map(c => c.kicker === kicker ? { ...c, enabled: !c.enabled } : c));
  }

  function removeCustom(key: string) {
    onConfigChange(config.filter(c => c.key !== key));
  }

  function submitAddCustom(e: React.SyntheticEvent) {
    e.preventDefault();
    if (addType === "decade") {
      const decade = Math.floor(Number(addDecade) / 10) * 10;
      if (!decade || Number.isNaN(decade)) return;
      onConfigChange([...config, {
        key: `custom-decade-${decade}-${Date.now()}`,
        kicker: `${decade}s`,
        enabled: true,
        customFilter: { type: "decade", decade },
      }]);
      setAddDecade("");
    } else {
      const artist = addArtist.trim();
      if (!artist) return;
      onConfigChange([...config, {
        key: `custom-artist-${Date.now()}`,
        kicker: artist,
        enabled: true,
        customFilter: { type: "artist", artist },
      }]);
      setAddArtist("");
    }
    setAddFormOpen(false);
  }

  function handleTabDragStart(e: React.DragEvent, index: number) {
    if (locked) return;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }
  function handleTabDragOver(e: React.DragEvent, index: number) {
    if (locked || dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropIndex(e.clientX < rect.left + rect.width / 2 ? index : index + 1);
  }
  function handleTabDrop(e: React.DragEvent) {
    if (locked) return;
    e.preventDefault();
    if (dragIndex !== null && dropIndex !== null) {
      reorderConfig(dragIndex, dropIndex);
    }
    setDragIndex(null);
    setDropIndex(null);
  }
  function handleTabDragEnd() {
    setDragIndex(null);
    setDropIndex(null);
  }

  const tabCount = locked ? groups.length : config.length;

  return (
    <section className="home-rail">
      <div className="home-rail__header">
        <p className="home-section-label" style={{ margin: 0 }}>For You</p>
        {onStartRadio && activeTabGroup.albums[0] && (
          <button className="home-section__radio-btn" onClick={() => onStartRadio(activeTabGroup.albums[0]!)} aria-label={`Start ${activeTabGroup.kicker} radio`} title="Start radio">
            <Radio size={13} />
          </button>
        )}
      </div>

      {!locked && (
        <p className="foryou-v2-edit-hint">Drag to reorder · Click a tab to enable/disable</p>
      )}

      <div className="foryou-v2-tabs" role="tablist" aria-label="For You categories">
        <div className="foryou-v2-tabs__list">
          {locked
            ? groups.map((group, i) => (
                <div key={group.kicker} className="foryou-v2-tab-slot">
                  <button
                    role="tab"
                    aria-selected={activeTabGroup.kicker === group.kicker}
                    tabIndex={activeTabGroup.kicker === group.kicker ? 0 : -1}
                    className={`foryou-v2-tab${activeTabGroup.kicker === group.kicker ? " foryou-v2-tab--active" : ""}`}
                    onClick={() => setActiveTabKicker(group.kicker)}
                    onKeyDown={e => handleTabKeyDown(e, i)}
                  >
                    {group.kicker}
                  </button>
                </div>
              ))
            : config.map((cat, i) => (
                <div key={cat.key} className="foryou-v2-tab-slot">
                  {dropIndex === i && <div className="foryou-v2-drop-line" />}
                  <button
                    role="tab"
                    aria-selected={activeTabGroup.kicker === cat.kicker}
                    aria-pressed={cat.enabled}
                    className={`foryou-v2-tab foryou-v2-tab--draggable${activeTabGroup.kicker === cat.kicker ? " foryou-v2-tab--active" : ""}${!cat.enabled ? " foryou-v2-tab--disabled" : ""}`}
                    onClick={() => toggleEnabled(cat.kicker)}
                    draggable
                    onDragStart={e => handleTabDragStart(e, i)}
                    onDragOver={e => handleTabDragOver(e, i)}
                    onDrop={handleTabDrop}
                    onDragEnd={handleTabDragEnd}
                    title={cat.enabled ? "Click to disable" : "Click to enable"}
                  >
                    {cat.kicker}
                  </button>
                  {cat.customFilter && (
                    <button
                      className="foryou-v2-remove-btn"
                      onClick={() => removeCustom(cat.key)}
                      aria-label={`Remove ${cat.kicker} category`}
                      title="Remove category"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              ))}
          {dropIndex === tabCount && <div className="foryou-v2-drop-line" />}
        </div>
        <div className="foryou-v2-tabs__actions">
          <button className="foryou-v2-action-btn" onClick={onRefresh} aria-label="Refresh suggestions">
            <RefreshCw size={14} />
          </button>
          {!locked && (
            <button
              className={`foryou-v2-action-btn${addFormOpen ? " foryou-v2-action-btn--active" : ""}`}
              onClick={() => setAddFormOpen(o => !o)}
              aria-label="Add custom category"
              aria-pressed={addFormOpen}
              title="Add a decade or artist category"
            >
              <Plus size={14} />
            </button>
          )}
          <button
            className={`foryou-v2-action-btn${!locked ? " foryou-v2-action-btn--active" : ""}`}
            onClick={() => setLocked(l => !l)}
            aria-label={locked ? "Unlock tab reordering" : "Lock tab reordering"}
            aria-pressed={!locked}
            title={locked ? "Unlock to reorder and enable/disable tabs" : "Lock tab order"}
          >
            {locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
        </div>
      </div>

      {!locked && addFormOpen && (
        <form className="foryou-v2-add-form" onSubmit={submitAddCustom}>
          <div className="foryou-v2-add-form__type">
            <button
              type="button"
              className={`foryou-v2-add-form__type-btn${addType === "decade" ? " foryou-v2-add-form__type-btn--active" : ""}`}
              onClick={() => setAddType("decade")}
            >
              Decade
            </button>
            <button
              type="button"
              className={`foryou-v2-add-form__type-btn${addType === "artist" ? " foryou-v2-add-form__type-btn--active" : ""}`}
              onClick={() => setAddType("artist")}
            >
              Artist
            </button>
          </div>
          {addType === "decade" ? (
            <input
              type="number"
              step={10}
              placeholder="e.g. 1990"
              value={addDecade}
              onChange={e => setAddDecade(e.target.value)}
              className="foryou-v2-add-form__input"
              autoFocus
            />
          ) : (
            <input
              type="text"
              placeholder="Artist name"
              value={addArtist}
              onChange={e => setAddArtist(e.target.value)}
              className="foryou-v2-add-form__input"
              autoFocus
            />
          )}
          <button type="submit" className="foryou-v2-add-form__submit">Add</button>
        </form>
      )}

      {descByKicker[activeTabGroup.kicker] && (
        <p className="foryou-v2-desc">{descByKicker[activeTabGroup.kicker]}</p>
      )}

      <div className="foryou-v2-grid" role="tabpanel">
        {activeTabGroup.albums.map(album => {
          const artUrl = coverMap.get(album.id) ?? getCoverArtUrl(server.url, server.username, credential, album.artwork_url!, 300);
          return (
            <div
              key={album.id}
              className="foryou-v2-tile"
              onClick={() => onSelectAlbum(album)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === "Enter" && onSelectAlbum(album)}
              onContextMenu={e => onCardContextMenu(e, album)}
            >
              <div className="foryou-v2-tile__art-wrap">
                <img className="foryou-v2-tile__art" src={artUrl} alt={album.name} decoding="async" loading="lazy" />
                <button
                  className="foryou-v2-tile__play"
                  onClick={e => { e.stopPropagation(); playAlbum(album); }}
                  aria-label={`Play ${album.name}`}
                >
                  <Play size={13} fill="currentColor" />
                </button>
              </div>
              <p className="foryou-v2-tile__name">{albumDisplayName(album.name)}</p>
              {album.artist && <p className="foryou-v2-tile__artist">{album.artist}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Featured Genres ───────────────────────────────────────────────────────────
// One flowing typographic line, size/weight stepped by relevance, no boxes.

interface FeaturedGenresSectionProps {
  genres: GenreRow[];
  onPlayGenre: (canonicalId: string, label?: string) => void;
}

function GenreChipsLine({ genres, onPlayGenre }: FeaturedGenresSectionProps) {
  if (genres.length === 0) return null;
  const ranked = genres.slice(0, 10);
  return (
    <>
      <p className="genre-line__caption">Recent genres · click to start a radio</p>
      <p className="genre-line">
        {ranked.map((g, i) => (
          <span key={g.canonical_id}>
            <button
              type="button"
              className={`genre-line__item genre-line__item--tier${Math.min(Math.floor(i / 3), 2)}`}
              onClick={() => onPlayGenre(g.canonical_id, g.name)}
              title={`Start a radio from ${g.name}`}
            >
              {g.name}
            </button>
            {i < ranked.length - 1 && <span className="genre-line__sep" aria-hidden="true">·</span>}
          </span>
        ))}
      </p>
    </>
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
  const coverMap = useAlbumCoverMap();

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
                const artUrl = coverMap.get(item.id) ?? (item.artwork_url
                  ? getCoverArtUrl(server.url, server.username, credential, item.artwork_url, 300)
                  : null);
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

  const spotlightCandidates = useMemo(
    () => buildSpotlightCandidates(
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

  const spotlightPicks = useMemo(
    () => dedupePicks(
      recommendedPick ? [recommendedPick, ...spotlightCandidates] : spotlightCandidates,
      3
    ),
    [recommendedPick, spotlightCandidates]
  );
  const primarySpotlight = spotlightPicks[0] ?? null;
  const secondarySpotlights = spotlightPicks.slice(1);

  const handleAddToQueue = useAddAlbumToQueue(serverWithCredential);
  const { data: playlists, addAlbumToPlaylist } = usePlaylists();

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
    () => buildForYouGroups(spotlightPicks.map(p => p.album.id), forYouSources, categoryConfig, forYouSeed, 6),
    [spotlightPicks, forYouSources, categoryConfig, forYouSeed]
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
      <div className="home-sticky-region">
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
              <button className="search-bar-clear" onClick={(e) => { searchInputRef.current?.blur(); e.currentTarget.blur(); onHomeSearchRawChange(""); }} title="Clear">
                <X size={13} />
              </button>
            ) : (
              <button className="home-search-palette-hint" onClick={onOpenCommandPalette} title="Command palette: search tracks, artists, albums, and navigate anywhere">
                <kbd>⌘K</kbd>
              </button>
            )}
          </div>
          {allAlbums != null && !isSearching && (
            <span className="home-greeting__sub">{allAlbums.length.toLocaleString()} albums</span>
          )}
        </header>

        {!isSearching && primarySpotlight && (
          <section className="home-fusion">
            <div className="home-fusion__spotlights">
              <Spotlight
                key={primarySpotlight.album.id}
                pick={primarySpotlight}
                serverWithCred={serverWithCredential}
                onSelectAlbum={onSelectAlbum}
                onSelectArtist={onSelectArtist}
                playAlbum={play}
                onAddToQueue={handleAddToQueue}
                onCardContextMenu={openCardContextMenu}
                primary
              />
              {secondarySpotlights.length > 0 && (
                <div className="home-fusion__spotlights-secondary">
                  {secondarySpotlights.map(pick => (
                    <Spotlight
                      key={pick.album.id}
                      pick={pick}
                      serverWithCred={serverWithCredential}
                      onSelectAlbum={onSelectAlbum}
                      onSelectArtist={onSelectArtist}
                      playAlbum={play}
                      onAddToQueue={handleAddToQueue}
                      onCardContextMenu={openCardContextMenu}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
        {!isSearching && featuredGenres.length > 0 && (
          <section className="home-genres-section">
            <GenreChipsLine genres={featuredGenres} onPlayGenre={handlePlayGenre} />
          </section>
        )}
      </div>

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
          <button onClick={() => { handleAddToQueue(contextMenu.album); setContextMenu(null); }}>
            Add to Queue
          </button>
          <StartRadioSubmenu
            onSelect={(mode) => { onStartRadio(contextMenu.album, mode); setContextMenu(null); }}
          />
          {playlists && playlists.length > 0 && (
            <ContextMenuSubmenu label="Add to Playlist">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => { void addAlbumToPlaylist(pl, contextMenu.album.id, serverWithCredential); setContextMenu(null); }}
                >
                  {pl.name}
                </button>
              ))}
            </ContextMenuSubmenu>
          )}
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
