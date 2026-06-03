import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Play, ListFilter, Search, X } from "lucide-react";
import { useGenreTree } from "../hooks/useGenreTree";
import { getParentChain } from "../lib/canonicalize";
import type { NodeSection } from "../lib/canonicalize";
import "../styles/genres.css";

const EMPTY_MAP = new Map<string, never>();
const EMPTY_SECTION: Record<string, string[]> = {};

// Cap so one very long label doesn't dominate.
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const containerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
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

  // naturalWidths: canvas-measured max-content width per column.
  // Canvas avoids overflow:hidden interference with DOM max-content measurement.
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

  // Measure natural widths via scrollWidth — returns full untruncated text width even
  // when overflow:hidden clips the visible content. No font parsing, no DOM thrashing.
  useLayoutEffect(() => {
    if (search) return;
    const colEls = containerRef.current?.querySelectorAll<HTMLElement>(".genre-column");
    if (!colEls?.length) return;
    const measured = Array.from(colEls).map((col) => {
      const rows = col.querySelectorAll<HTMLElement>(".genre-col-row");
      if (!rows.length) return 0;
      // chrome = everything in the row except the name's flex area (count + chevron + gaps + padding)
      const firstRow = rows[0]!;
      const firstName = firstRow.querySelector<HTMLElement>(".genre-col-name");
      const chrome = firstName ? firstRow.offsetWidth - firstName.offsetWidth : 0;
      let maxTextW = 0;
      rows.forEach((row) => {
        const nameEl = row.querySelector<HTMLElement>(".genre-col-name");
        if (nameEl) maxTextW = Math.max(maxTextW, nameEl.scrollWidth);
      });
      return Math.min(maxTextW + chrome, COL_MAX_WIDTH);
    });
    if (measured.some((w) => w > 0)) setNaturalWidths(measured);
  }, [columns, search]);

  // Applied widths: pure computation from natural widths + container width.
  // No DOM reads here. Reacts to window resize without re-measuring.
  const appliedWidths = useMemo(() => {
    if (naturalWidths.length === 0) return [];

    const total = naturalWidths.reduce((s, w) => s + w, 0);
    if (!containerWidth || total <= containerWidth) return naturalWidths;

    const n = naturalWidths.length;
    const widths = [...naturalWidths];
    let overage = total - containerWidth;

    // Floor per column index (from left). Last col has Infinity floor = never shrunk.
    // Col 0 floor ~4 chars, col 1 floor ~6 chars, col 2+ floor = natural minus 30px (min 60px).
    const floorFor = (i: number): number => {
      if (i === n - 1) return naturalWidths[i] ?? 0; // last col: never shrink
      if (i === 0) return 48;
      if (i === 1) return 72;
      return Math.max(60, (naturalWidths[i] ?? 60) - 30);
    };

    // Weighted shrink: col 0 absorbs 70%, col 1 absorbs 30%, col 2+ (not last) absorbs 1 unit each.
    const weights: number[] = widths.map((_, i) => {
      if (i === n - 1) return 0;
      if (i === 0) return 7;
      if (i === 1) return 3;
      return 1;
    });
    const totalWeight = weights.reduce((s, w) => s + w, 0);

    // First pass: weighted ask, clamped to each col's capacity.
    const asks: number[] = weights.map((w, i) => {
      const ask = totalWeight > 0 ? overage * (w / totalWeight) : 0;
      const capacity = (naturalWidths[i] ?? 0) - floorFor(i);
      return Math.max(0, Math.min(ask, capacity));
    });

    let absorbed = asks.reduce((s, a) => s + a, 0);
    overage -= absorbed;

    // Second pass: if still over, give remainder to cols that still have capacity, left-first.
    for (let i = 0; i < n - 1 && overage > 0.5; i++) {
      const capacity = (naturalWidths[i] ?? 0) - floorFor(i) - (asks[i] ?? 0);
      if (capacity > 0) {
        const extra = Math.min(capacity, overage);
        asks[i] = (asks[i] ?? 0) + extra;
        overage -= extra;
      }
    }

    for (let i = 0; i < n; i++) {
      widths[i] = (naturalWidths[i] ?? 0) - (asks[i] ?? 0);
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
