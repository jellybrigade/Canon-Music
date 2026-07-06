import { useMemo, useRef, useState } from "react";
import { Play, ListFilter, Search, X } from "lucide-react";
import { useGenreTree } from "../hooks/useGenreTree";
import { getParentChain } from "../lib/canonicalize";
import type { NodeSection } from "../lib/canonicalize";
import "../styles/genres.css";

const EMPTY_MAP = new Map<string, never>();
const EMPTY_SECTION: Record<string, string[]> = {};

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

  // Stable references, empty fallbacks so hooks run unconditionally before data loads.
  const nodeById = data?.nodeById ?? EMPTY_MAP;
  const childrenById = data?.childrenById ?? EMPTY_MAP;
  const countById = data?.countById ?? EMPTY_MAP;
  const rootsBySection = data?.rootsBySection ?? EMPTY_SECTION;

  const columns = useMemo(() => {
    const cols: string[][] = [rootsBySection[section] ?? []];
    const visited = new Set<string>();
    for (const selectedId of path) {
      if (visited.has(selectedId)) break;
      visited.add(selectedId);
      const kids = (childrenById.get(selectedId) ?? []).filter((id) => !visited.has(id));
      if (kids.length === 0) break;
      cols.push(kids);
    }
    return cols;
  }, [rootsBySection, section, path, childrenById]);

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
                      {parentChain.map((seg, i) => (
                        <span key={i} style={{ flexShrink: parentChain.length - i }} className="genre-col-breadcrumb__seg">
                          {seg}
                          {i < parentChain.length - 1 && <span className="genre-col-breadcrumb__sep"> ›</span>}
                        </span>
                      ))}
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
        <div className="genre-columns">
          {columns.map((colIds, depth) => {
            const selectedInCol = path[depth] ?? null;
            const unique = [...new Set(colIds)];
            return (
              <div
                key={depth}
                className="genre-column"
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
                      <div className="genre-col-right">
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
