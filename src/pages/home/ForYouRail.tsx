import { useMemo, useState } from "react";
import { Lock, Play, Plus, RefreshCw, Unlock, X } from "lucide-react";
import { useAlbumDisplayName } from "../../hooks/useAlbumDisplayName";
import { getCoverArtUrl } from "../../clients/navidromeUrls";
import { FOR_YOU_PER_TAB_CHOICES, type ForYouCategoryConfig, type ForYouGroup } from "../../lib/forYouGroups";
import type { ServerWithCredential } from "../../hooks/useServer";
import type { AlbumRow } from "../../types/library";
import { useAlbumCoverMap } from "../../hooks/useCoverCache";
import "./ForYouRail.css";

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

export const DEFAULT_FOR_YOU_CONFIG: ForYouCategoryConfig[] = FOR_YOU_CATEGORIES.map(c => ({
  ...c,
  enabled: DEFAULT_FOR_YOU_ENABLED.has(c.key),
}));

export const DEFAULT_FOR_YOU_CONFIG_JSON = JSON.stringify(DEFAULT_FOR_YOU_CONFIG);

const FOR_YOU_CATEGORY_DESC: Record<string, string> = Object.fromEntries(
  FOR_YOU_CATEGORIES.map(c => [c.key, c.desc])
);

/** Merges a saved config with the canonical category list so newly-added categories
 *  always appear (appended, using their default enabled state). */
export function mergeForYouConfig(saved: ForYouCategoryConfig[]): ForYouCategoryConfig[] {
  const savedKeys = new Set(saved.map(c => c.key));
  const added = FOR_YOU_CATEGORIES
    .filter(c => !savedKeys.has(c.key))
    .map(c => ({ ...c, enabled: DEFAULT_FOR_YOU_ENABLED.has(c.key) }));
  return [...saved, ...added];
}


interface ForYouRailProps {
  groups: ForYouGroup[];
  isLoading?: boolean;
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  playAlbum: (album: AlbumRow) => void;
  onRefresh: () => void;
  onCardContextMenu: (e: React.MouseEvent, album: AlbumRow) => void;
  config: ForYouCategoryConfig[];
  onConfigChange: (config: ForYouCategoryConfig[]) => void;
  perTab: number;
  onPerTabChange: (count: number) => void;
}

export function ForYouRail({ groups, isLoading, serverWithCred, onSelectAlbum, playAlbum, onRefresh, onCardContextMenu, config, onConfigChange, perTab, onPerTabChange }: ForYouRailProps) {
  const { server, credential } = serverWithCred;
  const albumDisplayName = useAlbumDisplayName();
  const coverMap = useAlbumCoverMap();
  const descByKey = useMemo(() => {
    const map: Record<string, string> = {};
    for (const cat of config) {
      if (cat.customFilter) {
        map[cat.key] = cat.customFilter.type === "decade"
          ? `Albums from the ${cat.customFilter.decade}s`
          : `Albums by ${cat.customFilter.artist}`;
      } else if (FOR_YOU_CATEGORY_DESC[cat.key]) {
        map[cat.key] = FOR_YOU_CATEGORY_DESC[cat.key]!;
      }
    }
    return map;
  }, [config]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
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
          {Array.from({ length: perTab }).map((_, i) => (
            <div key={i} className="foryou-v2-tile">
              <div className="foryou-v2-tile__art-wrap foryou-v2-tile__art-wrap--skeleton" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  const activeTabGroup = groups.find(g => g.key === activeTabKey) ?? groups[0]!;

  function handleTabKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? (index + 1) % groups.length : (index - 1 + groups.length) % groups.length;
    setActiveTabKey(groups[next]!.key);
  }

  function reorderConfig(fromIndex: number, toIndex: number) {
    const effectiveSlot = toIndex > fromIndex ? toIndex - 1 : toIndex;
    if (effectiveSlot === fromIndex) return;
    const next = [...config];
    const [item] = next.splice(fromIndex, 1);
    next.splice(effectiveSlot, 0, item!);
    onConfigChange(next);
  }

  function toggleEnabled(key: string) {
    onConfigChange(config.map(c => c.key === key ? { ...c, enabled: !c.enabled } : c));
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
      </div>

      {!locked && (
        <div className="foryou-v2-edit-row">
          <p className="foryou-v2-edit-hint">Drag to reorder · Click a tab to enable/disable</p>
          <label className="foryou-v2-per-tab">
            Albums per tab
            <select
              className="foryou-v2-per-tab__select"
              value={perTab}
              onChange={e => onPerTabChange(Number(e.target.value))}
            >
              {FOR_YOU_PER_TAB_CHOICES.map(count => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="foryou-v2-tabs" role="tablist" aria-label="For You categories">
        <div className="foryou-v2-tabs__list">
          {locked
            ? groups.map((group, i) => (
                <div key={group.key} className="foryou-v2-tab-slot">
                  <button
                    role="tab"
                    aria-selected={activeTabGroup.key === group.key}
                    tabIndex={activeTabGroup.key === group.key ? 0 : -1}
                    className={`foryou-v2-tab${activeTabGroup.key === group.key ? " foryou-v2-tab--active" : ""}`}
                    onClick={() => setActiveTabKey(group.key)}
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
                    aria-selected={activeTabGroup.key === cat.key}
                    aria-pressed={cat.enabled}
                    className={`foryou-v2-tab foryou-v2-tab--draggable${activeTabGroup.key === cat.key ? " foryou-v2-tab--active" : ""}${!cat.enabled ? " foryou-v2-tab--disabled" : ""}`}
                    onClick={() => toggleEnabled(cat.key)}
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
      </div>

      <div className="foryou-v2-desc-row">
        {descByKey[activeTabGroup.key] && (
          <p className="foryou-v2-desc">{descByKey[activeTabGroup.key]}</p>
        )}
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

      <div className="foryou-v2-grid" role="tabpanel">
        {activeTabGroup.albums.map(album => {
          const artUrl = coverMap.get(album.id) ?? (album.artwork_url
            ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 300)
            : null);
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
                {artUrl
                  ? <img className="foryou-v2-tile__art" src={artUrl} alt={album.name} decoding="async" loading="lazy" />
                  : <div className="foryou-v2-tile__art" />}
                <button
                  className="foryou-v2-tile__play"
                  onClick={e => { e.stopPropagation(); playAlbum(album); }}
                  aria-label={`Play ${album.name}`}
                >
                  <Play size={13} fill="currentColor" />
                </button>
              </div>
              <p className="foryou-v2-tile__name">{albumDisplayName(album.name, album.id)}</p>
              {album.artist && <p className="foryou-v2-tile__artist">{album.artist}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
