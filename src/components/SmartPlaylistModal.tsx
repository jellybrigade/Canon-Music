import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { ListMusic, X, RefreshCw } from "lucide-react";
import { useGenres } from "../hooks/useGenres";
import {
  DEFAULT_SMART_FILTERS,
  SORT_OPTIONS,
  YEAR_MIN,
  YEAR_MAX,
  LIMIT_MAX,
  type SmartFilters,
} from "../lib/smartPlaylist";
import "./SmartPlaylistModal.css";

interface Props {
  initialFilters?: SmartFilters;
  onSave: (filters: SmartFilters) => Promise<void>;
  onClose: () => void;
  title?: string;
}

export function SmartPlaylistModal({ initialFilters, onSave, onClose, title = "New Smart Playlist" }: Props) {
  const [filters, setFilters] = useState<SmartFilters>(initialFilters ?? DEFAULT_SMART_FILTERS);
  const [saving, setSaving] = useState(false);
  const [genreSearch, setGenreSearch] = useState("");
  const { data: allGenres = [] } = useGenres();

  const availableGenres = useMemo(() => {
    const selected = new Set(filters.selectedGenres);
    const q = genreSearch.toLowerCase().trim();
    return allGenres.filter((g) => !selected.has(g.canonical_id) && (!q || g.name.toLowerCase().includes(q)));
  }, [allGenres, filters.selectedGenres, genreSearch]);

  function set<K extends keyof SmartFilters>(key: K, value: SmartFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function addGenre(id: string) {
    setFilters((f) => ({ ...f, selectedGenres: [...f.selectedGenres, id] }));
  }

  function removeGenre(id: string) {
    setFilters((f) => ({ ...f, selectedGenres: f.selectedGenres.filter((g) => g !== id) }));
  }

  function genreName(id: string): string {
    return allGenres.find((g) => g.canonical_id === id)?.name ?? id;
  }

  async function handleSave() {
    const name = filters.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      await onSave({ ...filters, name });
      onClose();
    } catch (e) {
      console.error("Failed to save smart playlist:", e);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="spm-overlay" onClick={onClose}>
      <div className="spm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="spm-header">
          <h2 className="spm-title">
            <ListMusic size={16} />
            {title}
          </h2>
          <button className="spm-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="spm-body">
          <section className="spm-section">
            <div className="spm-field">
              <label className="spm-label">Name</label>
              <input
                className="spm-input"
                type="text"
                placeholder="Playlist name…"
                value={filters.name}
                onChange={(e) => set("name", e.target.value)}
                autoFocus
              />
            </div>

            <div className="spm-row">
              <div className="spm-field spm-field--half">
                <label className="spm-label">Limit</label>
                <input
                  className="spm-input"
                  type="number"
                  min={1}
                  max={LIMIT_MAX}
                  value={filters.limit}
                  onChange={(e) => set("limit", Math.max(1, Math.min(LIMIT_MAX, Number(e.target.value) || 50)))}
                />
              </div>
              <div className="spm-field spm-field--half">
                <label className="spm-label">Sort</label>
                <select
                  className="spm-select"
                  value={filters.sort}
                  onChange={(e) => set("sort", e.target.value)}
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="spm-section">
            <div className="spm-section-title">Filters</div>

            <div className="spm-field">
              <label className="spm-label">Artist contains</label>
              <input
                className="spm-input"
                type="text"
                placeholder="e.g. Beatles"
                value={filters.artistContains}
                onChange={(e) => set("artistContains", e.target.value)}
              />
            </div>
            <div className="spm-field">
              <label className="spm-label">Album contains</label>
              <input
                className="spm-input"
                type="text"
                placeholder="e.g. Live"
                value={filters.albumContains}
                onChange={(e) => set("albumContains", e.target.value)}
              />
            </div>
            <div className="spm-field">
              <label className="spm-label">Title contains</label>
              <input
                className="spm-input"
                type="text"
                placeholder="e.g. Blues"
                value={filters.titleContains}
                onChange={(e) => set("titleContains", e.target.value)}
              />
            </div>

            <div className="spm-row">
              <div className="spm-field spm-field--half">
                <label className="spm-label">Year from</label>
                <input
                  className="spm-input"
                  type="number"
                  min={YEAR_MIN}
                  max={YEAR_MAX}
                  placeholder="e.g. 1970"
                  value={filters.yearFrom ?? ""}
                  onChange={(e) => set("yearFrom", e.target.value ? Number(e.target.value) : null)}
                />
              </div>
              <div className="spm-field spm-field--half">
                <label className="spm-label">Year to</label>
                <input
                  className="spm-input"
                  type="number"
                  min={YEAR_MIN}
                  max={YEAR_MAX}
                  placeholder="e.g. 1979"
                  value={filters.yearTo ?? ""}
                  onChange={(e) => set("yearTo", e.target.value ? Number(e.target.value) : null)}
                />
              </div>
            </div>

            <div className="spm-field">
              <label className="spm-label">Min play count</label>
              <input
                className="spm-input"
                type="number"
                min={0}
                placeholder="0"
                value={filters.minPlayCount || ""}
                onChange={(e) => set("minPlayCount", Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          </section>

          <section className="spm-section">
            <div className="spm-section-title">
              Genres
              <div className="spm-genre-mode-toggle">
                <button
                  type="button"
                  className={`spm-mode-btn${filters.genreMode === "include" ? " spm-mode-btn--active" : ""}`}
                  onClick={() => set("genreMode", "include")}
                >
                  Include
                </button>
                <button
                  type="button"
                  className={`spm-mode-btn${filters.genreMode === "exclude" ? " spm-mode-btn--active" : ""}`}
                  onClick={() => set("genreMode", "exclude")}
                >
                  Exclude
                </button>
              </div>
            </div>

            {filters.selectedGenres.length > 0 && (
              <div className="spm-genre-selected">
                {filters.selectedGenres.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`spm-genre-chip spm-genre-chip--selected spm-genre-chip--${filters.genreMode}`}
                    onClick={() => removeGenre(id)}
                    title="Remove"
                  >
                    {genreName(id)}
                    <X size={11} />
                  </button>
                ))}
              </div>
            )}

            <input
              className="spm-input spm-genre-search"
              type="text"
              placeholder="Search genres…"
              value={genreSearch}
              onChange={(e) => setGenreSearch(e.target.value)}
            />
            <div className="spm-genre-list">
              {availableGenres.slice(0, 60).map((g) => (
                <button
                  key={g.canonical_id}
                  type="button"
                  className="spm-genre-chip"
                  onClick={() => addGenre(g.canonical_id)}
                >
                  {g.name}
                </button>
              ))}
              {availableGenres.length === 0 && (
                <span className="spm-genre-empty">No genres found</span>
              )}
            </div>
          </section>
        </div>

        <div className="spm-footer">
          <button className="spm-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="spm-btn spm-btn--primary"
            onClick={() => void handleSave()}
            disabled={saving || !filters.name.trim()}
          >
            <RefreshCw size={13} />
            {saving ? "Saving…" : title.startsWith("Edit") ? "Save & Refresh" : "Create"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
