import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Play, ListFilter, Search, X } from "lucide-react";
import { useGenreTree } from "../hooks/useGenreTree";
import { getParentChain } from "../lib/canonicalize";
import type { NodeSection } from "../lib/canonicalize";
import "../styles/genres.css";

const EMPTY_MAP = new Map<string, never>();
const EMPTY_SECTION: Record<string, string[]> = {};

// Floor so a shrunk column stays legible; cap so one very long label doesn't dominate.
const COL_MIN_WIDTH = 100;
const COL_MAX_WIDTH = 480;

type SectionTab = NodeSection;
const SECTION_LABELS: Record<NodeSection, string> = {
  genres: "Genres",
  descriptors: "Descriptors",
  "scenes-and-movements": "Scenes & Movements",
};

interface Props {
  onSelectGenre: (canonicalId: string) => void;
  onPlayGenre: (canonicalId: string, label?: string) => void;
}

export function GenreView({ onSelectGenre, onPlayGenre }: Props) {
  const data = useGenreTree();
  const [section, setSection] = useState<SectionTab>("genres");
  const [path, setPath] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Container width — tracked by ResizeObserver so applied widths recompute on resize.
  const [containerWidth, setContainerWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const containerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    observerRef.current = ro;
  }, []);

  // Refs to the rendered column divs — populated in the columns.map below.
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);

  // naturalWidths: DOM-measured max-content width per column.
  // Updated only when column *content* changes (section/path navigation).
  const [naturalWidths, setNaturalWidths] = useState<number[]>([]);

  // Stable references — empty fallbacks so hooks run unconditionally before data loads.
  const nodeById = data?.nodeById ?? EMPTY_MAP;
  const childrenById = data?.childrenById ?? EMPTY_MAP;
  const countById = data?.countById ?? EMPTY_MAP;
  const rootsBySection = data?.rootsBySection ?? EMPTY_SECTION;

  const columns = useMemo(() => {
    const cols: string[][] = [rootsBySection[section] ?? []];
    for (const selectedId of path) {
      const kids = childrenById.get(selectedId) ?? [];
      if (kids.length === 0) break;
      cols.push(kids);
    }
    return cols;
  }, [rootsBySection, section, path, childrenById]);

  // Measure natural (max-content) widths after every content change.
  // Depends on `columns` so it also fires when data first loads (columns goes
  // from [[]] to real roots). useLayoutEffect + setState flush synchronously
  // before the browser paints, so columns are never visually full-width.
  useLayoutEffect(() => {
    if (search) return; // columns not rendered during search
    const measured: number[] = [];
    for (const el of colRefs.current) {
      if (!el) continue;
      // Temporarily lay out at max-content to get the true intrinsic width.
      const prevFlex = el.style.flex;
      const prevWidth = el.style.width;
      el.style.flex = "none";
      el.style.width = "max-content";
      // offsetWidth forces a synchronous reflow — captures real font size,
      // scrollbar, border, and padding with zero guesswork.
      const w = Math.min(el.offsetWidth, COL_MAX_WIDTH);
      el.style.flex = prevFlex;
      el.style.width = prevWidth;
      measured.push(w);
    }
    if (measured.length > 0) setNaturalWidths(measured);
  }, [columns]); // columns is memoized; changes on data-load and navigation

  // Applied widths: pure computation from natural widths + container width.
  // No DOM reads here. Reacts to window resize without re-measuring.
  const appliedWidths = useMemo(() => {
    if (naturalWidths.length === 0) return [];

    const total = naturalWidths.reduce((s, w) => s + w, 0);
    if (!containerWidth || total <= containerWidth) return naturalWidths;

    // Left-first truncation: column 0 shrinks toward COL_MIN_WIDTH first,
    // then column 1, etc. Rightmost (current) column is never shrunk first.
    const widths = [...naturalWidths];
    let overage = total - containerWidth;
    for (let i = 0; i < widths.length && overage > 0; i++) {
      const w = widths[i] ?? COL_MIN_WIDTH;
      const canShrink = w - COL_MIN_WIDTH;
      if (canShrink > 0) {
        const shrink = Math.min(canShrink, overage);
        widths[i] = w - shrink;
        overage -= shrink;
      }
    }
    return widths;
  }, [naturalWidths, containerWidth]);

  if (!data) {
    return (
      <div className="genre-view">
        <p className="genre-view__loading">Loading genres…</p>
      </div>
    );
  }

  const availableSections = (
    ["genres", "descriptors", "scenes-and-movements"] as NodeSection[]
  ).filter((s) => (rootsBySection[s]?.length ?? 0) > 0);

  function handleSectionChange(s: SectionTab) {
    setSection(s);
    setPath([]);
    setSearch("");
  }

  const searchLower = search.toLowerCase();
  const searchResults = search
    ? Array.from(nodeById.values())
        .filter(
          (n) =>
            n.name.toLowerCase().includes(searchLower) &&
            (countById.get(n.id) ?? 0) > 0
        )
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        )
    : [];

  function handleNodeClick(nodeId: string, depth: number) {
    setPath([...path.slice(0, depth), nodeId]);
  }

  const breadcrumbNames = path.map((id) => nodeById.get(id)?.name ?? id);

  return (
    <div className="genre-view">
      {/* ── Section tabs ── */}
      <div className="genre-tabs">
        {availableSections.map((s) => (
          <button
            key={s}
            className={`genre-tab${section === s ? " genre-tab--active" : ""}`}
            onClick={() => handleSectionChange(s)}
          >
            {SECTION_LABELS[s]}
          </button>
        ))}
      </div>

      {/* ── Search ── */}
      <div className="genre-search">
        <Search size={14} className="genre-search__icon" aria-hidden />
        <input
          ref={searchRef}
          className="genre-search__input"
          type="text"
          placeholder="Search genres…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPath([]);
          }}
          aria-label="Search genres"
        />
        {search && (
          <button
            className="genre-search__clear"
            onClick={() => {
              setSearch("");
              setPath([]);
              searchRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* ── Breadcrumb ── */}
      {!search && breadcrumbNames.length > 0 && (
        <div className="genre-breadcrumb">
          {breadcrumbNames.map((name, i) => (
            <span key={i} className="genre-breadcrumb__item">
              {i > 0 && <span className="genre-breadcrumb__sep">›</span>}
              <button
                className="genre-breadcrumb__node"
                onClick={() => setPath(path.slice(0, i + 1))}
              >
                {name}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Search results ── */}
      {search ? (
        <div className="genre-search-results">
          {searchResults.length === 0 ? (
            <p className="genre-search-results__empty">
              No genres match "{search}"
            </p>
          ) : (
            searchResults.map((node) => {
              const parentChain = getParentChain(node, nodeById, 4);
              const count = countById.get(node.id) ?? 0;
              return (
                <div
                  key={node.id}
                  className="genre-col-row genre-search-result-row"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSelectGenre(node.id);
                  }}
                >
                  <span className="genre-col-name">{node.name}</span>
                  {parentChain.length > 0 && (
                    <span className="genre-col-breadcrumb">
                      {parentChain.join(" › ")}
                    </span>
                  )}
                  <span className="genre-col-count">{count}</span>
                  <div className="genre-col-actions">
                    <button
                      className="genre-col-action-btn"
                      title="Browse in Library"
                      onClick={(e) => { e.stopPropagation(); onSelectGenre(node.id); }}
                      aria-label="Filter library to this genre"
                    >
                      <ListFilter size={15} strokeWidth={2} />
                    </button>
                    <button
                      className="genre-col-action-btn genre-col-action-btn--play"
                      title="Shuffle play"
                      onClick={(e) => { e.stopPropagation(); onPlayGenre(node.id, node.name); }}
                      aria-label="Shuffle play this genre"
                    >
                      <Play size={14} fill="currentColor" strokeWidth={0} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* ── Miller columns ── */
        <div className="genre-columns" ref={containerCallbackRef}>
          {columns.map((colIds, depth) => {
            const selectedInCol = path[depth] ?? null;
            const unique = [...new Set(colIds)];
            // appliedWidths[depth] is set after measurement; fall back to CSS flex
            // on the very first paint (before useLayoutEffect has fired).
            const appliedW = appliedWidths[depth];
            return (
              <div
                key={depth}
                ref={(el) => { colRefs.current[depth] = el; }}
                className="genre-column"
                style={appliedW !== undefined ? { flex: "none", width: appliedW } : undefined}
              >
                {unique.map((nodeId) => {
                  const node = nodeById.get(nodeId);
                  if (!node) return null;
                  const count = countById.get(nodeId) ?? 0;
                  const hasChildren =
                    (childrenById.get(nodeId)?.length ?? 0) > 0;
                  const isSelected = selectedInCol === nodeId;
                  return (
                    <div
                      key={nodeId}
                      className={`genre-col-row${isSelected ? " genre-col-row--selected" : ""}`}
                      onClick={() => handleNodeClick(nodeId, depth)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ")
                          handleNodeClick(nodeId, depth);
                      }}
                    >
                      <span className="genre-col-name">{node.name}</span>
                      <span className="genre-col-count">{count}</span>
                      <span className={`genre-col-chevron${hasChildren ? "" : " genre-col-chevron--hidden"}`} aria-hidden>›</span>
                      <div className="genre-col-actions">
                        <button
                          className="genre-col-action-btn"
                          title="Browse in Library"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectGenre(nodeId);
                          }}
                          aria-label="Filter library to this genre"
                        >
                          <ListFilter size={15} strokeWidth={2} />
                        </button>
                        <button
                          className="genre-col-action-btn genre-col-action-btn--play"
                          title="Shuffle play"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlayGenre(nodeId, node.name);
                          }}
                          aria-label="Shuffle play this genre"
                        >
                          <Play size={14} fill="currentColor" strokeWidth={0} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
