import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, X } from "lucide-react";
import type { GenreRow } from "../hooks/useGenres";
import "./FilterSidebar.css";

interface Props {
  genres: GenreRow[];
  canonicalIdFilters: string[];
  toggleCanonicalIdFilter: (id: string) => void;
  clearGenreFilters: () => void;
  yearFromInput: string;
  yearToInput: string;
  setYearFromInput: (v: string) => void;
  setYearToInput: (v: string) => void;
  lovedOnly: boolean;
  toggleLovedOnly: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

function hasActiveFilters(
  canonicalIdFilters: string[],
  yearFromInput: string,
  yearToInput: string,
  lovedOnly: boolean
): boolean {
  return canonicalIdFilters.length > 0 || yearFromInput !== "" || yearToInput !== "" || lovedOnly;
}

export function FilterSidebar({
  genres,
  canonicalIdFilters,
  toggleCanonicalIdFilter,
  clearGenreFilters,
  yearFromInput,
  yearToInput,
  setYearFromInput,
  setYearToInput,
  lovedOnly,
  toggleLovedOnly,
  isOpen,
  onToggle,
}: Props) {
  const filtersActive = hasActiveFilters(canonicalIdFilters, yearFromInput, yearToInput, lovedOnly);
  const [genreSearch, setGenreSearch] = useState("");
  const matchingGenres = useMemo(() => {
    const needle = genreSearch.trim().toLowerCase();
    return needle ? genres.filter((g) => g.name.toLowerCase().includes(needle)) : genres;
  }, [genres, genreSearch]);

  function clearAll() {
    clearGenreFilters();
    setYearFromInput("");
    setYearToInput("");
    if (lovedOnly) toggleLovedOnly();
  }

  return (
    <aside className={`filter-sidebar${isOpen ? " filter-sidebar--open" : ""}`}>
      <div className="filter-sidebar-toggle" onClick={onToggle} title={isOpen ? "Collapse filters" : "Expand filters"}>
        {filtersActive && !isOpen && <span className="filter-sidebar-dot" />}
        {isOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </div>

      {isOpen && (
        <div className="filter-sidebar-body">
          {filtersActive && (
            <button className="filter-sidebar-clear-all" onClick={clearAll}>
              <X size={11} />
              Clear all
            </button>
          )}

          <button
            className={`filter-sidebar-loved${lovedOnly ? " filter-sidebar-loved--active" : ""}`}
            onClick={toggleLovedOnly}
          >
            <Heart size={13} fill={lovedOnly ? "currentColor" : "none"} strokeWidth={2} />
            Loved
          </button>

          <div className="filter-sidebar-section">
            <div className="filter-sidebar-section-header">
              <span>Year</span>
              {(yearFromInput !== "" || yearToInput !== "") && (
                <button
                  className="filter-sidebar-clear-btn"
                  onClick={() => { setYearFromInput(""); setYearToInput(""); }}
                  title="Clear year filter"
                >
                  <X size={10} />
                </button>
              )}
            </div>
            <div className="filter-sidebar-year-row">
              <input
                className="filter-sidebar-year-input"
                type="number"
                placeholder="From"
                value={yearFromInput}
                onChange={(e) => setYearFromInput(e.target.value)}
                min={1900}
                max={2100}
              />
              <span className="filter-sidebar-year-sep">-</span>
              <input
                className="filter-sidebar-year-input"
                type="number"
                placeholder="To"
                value={yearToInput}
                onChange={(e) => setYearToInput(e.target.value)}
                min={1900}
                max={2100}
              />
            </div>
          </div>

          {genres.length > 0 && (
            <div className="filter-sidebar-section">
              <div className="filter-sidebar-section-header">
                <span>Genre</span>
                {canonicalIdFilters.length > 0 && (
                  <button
                    className="filter-sidebar-clear-btn"
                    onClick={clearGenreFilters}
                    title="Clear genre filter"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
              <input
                className="filter-sidebar-genre-search"
                type="text"
                placeholder="Search…"
                value={genreSearch}
                onChange={(e) => setGenreSearch(e.target.value)}
              />
              <div className="filter-sidebar-genre-list">
                {matchingGenres.length === 0 ? (
                  <p className="filter-sidebar-genre-empty">
                    No genre matches "{genreSearch}".
                  </p>
                ) : (
                  matchingGenres.map((g) => (
                    <button
                      key={g.canonical_id}
                      className={`filter-sidebar-genre-item${canonicalIdFilters.includes(g.canonical_id) ? " filter-sidebar-genre-item--active" : ""}`}
                      onClick={() => toggleCanonicalIdFilter(g.canonical_id)}
                    >
                      <span className="filter-sidebar-genre-name">{g.name}</span>
                      <span className="filter-sidebar-genre-count">{g.album_count}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
