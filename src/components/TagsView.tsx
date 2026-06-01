import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Unlock } from "lucide-react";
import { useVocabulary, useTagMappings, useAutoMapExact, useUnresolvedGenres } from "../hooks/useTagMappings";
import type { UnresolvedGenreRow } from "../hooks/useTagMappings";
import { getCanonTree, canonicalKey } from "../lib/canonicalize";
import type { TreeNode } from "../lib/canonicalize";
import type { TagKind } from "../lib/canonicalize";
import type { VocabRow } from "../hooks/useTagMappings";
import "./TagsView.css";

interface ComboboxProps {
  treeNodes: TreeNode[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
}

function CanonCombobox({ treeNodes, currentId, onSelect, onClear }: ComboboxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const currentName = useMemo(
    () => treeNodes.find((n) => n.id === currentId)?.name ?? null,
    [treeNodes, currentId]
  );

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return treeNodes
      .filter((n) => n.name.toLowerCase().includes(q) || n.canonical_key.toLowerCase().includes(q))
      .slice(0, 10);
  }, [treeNodes, query]);

  function openDropdown() {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: "fixed",
        top: rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 220),
        zIndex: 9999,
      });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  if (currentId && currentName) {
    return (
      <div className="tags-mapped">
        <span className="tags-mapped-name">{currentName}</span>
        <button className="tags-clear-btn" onClick={onClear} title="Remove mapping">×</button>
      </div>
    );
  }

  return (
    <div className="tags-combobox" ref={wrapRef}>
      <input
        ref={inputRef}
        className="tags-combobox-input"
        placeholder="Search canon tree…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); openDropdown(); }}
        onFocus={openDropdown}
      />
      {open && matches.length > 0 && createPortal(
        <div className="tags-combobox-dropdown" style={dropdownStyle}>
          {matches.map((n) => (
            <button
              key={n.id}
              className="tags-combobox-option"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(n.id);
                setQuery("");
                setOpen(false);
              }}
            >
              <span className="tags-option-name">{n.name}</span>
              <span className="tags-option-section">{n.section ?? n.type}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

const ACCEPTED = "__accepted__";
const IGNORED = "__ignored__";

function mappingDot(row: VocabRow, nodeById: Map<string, TreeNode>): { color: string; title: string } | null {
  if (!row.canonical_id) return null;
  if (row.canonical_id === ACCEPTED) return { color: "green", title: "Accepted as-is" };
  if (row.canonical_id === IGNORED) return { color: "red", title: "Ignored — excluded from genre output" };
  if (row.mapping_source === "manual") return { color: "blue", title: "Manually mapped" };
  const node = nodeById.get(row.canonical_id);
  const rawNorm = canonicalKey(row.raw_value);
  const canonNorm = node ? canonicalKey(node.name) : null;
  if (canonNorm === rawNorm) return null;
  return { color: "orange", title: `Auto-mapped — "${row.raw_value}" → "${node?.name ?? row.canonical_id}"` };
}

/** Normalize section/kind strings to consistent singular badge labels. */
function normalizeSection(s: string): string {
  if (s === "genres" || s === "genre") return "genre";
  if (s === "descriptors" || s === "descriptor") return "descriptor";
  if (s === "scenes-and-movements" || s === "scene") return "scene";
  if (s === "mood" || s === "moods") return "descriptor";
  return s;
}

/** Resolve the badge label for a vocab row. */
function resolvedSection(row: VocabRow, nodeById: Map<string, TreeNode>): string {
  if (!row.canonical_id || row.canonical_id === ACCEPTED || row.canonical_id === IGNORED) {
    return normalizeSection(row.kind);
  }
  const section = nodeById.get(row.canonical_id)?.section ?? row.kind;
  return normalizeSection(section);
}

function isTrivialExactMatch(row: VocabRow, nodeById: Map<string, TreeNode>): boolean {
  if (!row.canonical_id || row.canonical_id === ACCEPTED || row.canonical_id === IGNORED) return false;
  if (row.mapping_source !== "auto" || row.mapping_match_type !== "exact") return false;
  const node = nodeById.get(row.canonical_id);
  return node ? canonicalKey(row.raw_value) === canonicalKey(node.name) : false;
}

function groupByFirstLetter(rows: VocabRow[]): Array<{ letter: string; rows: VocabRow[] }> {
  const groups: Record<string, VocabRow[]> = {};
  for (const row of rows) {
    const first = row.raw_value[0]?.toUpperCase() ?? "#";
    const key = /[A-Z]/.test(first) ? first : "#";
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, letterRows]) => ({ letter, rows: letterRows }));
}

export function TagsView() {
  const { data: vocab } = useVocabulary();
  const { data: unresolvedGenres } = useUnresolvedGenres();
  const { saveMapping, deleteMapping, lockMapping } = useTagMappings();
  const autoMapExact = useAutoMapExact();
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [showTrivial, setShowTrivial] = useState(false);
  const [search, setSearch] = useState("");

  const nodeById = useMemo(() => new Map(treeNodes.map((n) => [n.id, n])), [treeNodes]);

  useEffect(() => {
    getCanonTree().then((tree) => setTreeNodes(tree.nodes)).catch(console.error);
  }, []);

  useEffect(() => {
    autoMapExact.mutate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trivialCount = useMemo(
    () => vocab?.filter((r) => isTrivialExactMatch(r, nodeById)).length ?? 0,
    [vocab, nodeById]
  );

  const rows = useMemo(() => {
    if (!vocab) return [];
    const isUnresolved = (r: { canonical_id: string | null }) =>
      !r.canonical_id || r.canonical_id === ACCEPTED || r.canonical_id === IGNORED;
    let filtered = showAll
      ? showTrivial ? vocab : vocab.filter((r) => !isTrivialExactMatch(r, nodeById))
      : vocab.filter(isUnresolved);
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((r) => r.raw_value.toLowerCase().includes(q));
    }
    return filtered;
  }, [vocab, showAll, showTrivial, search, nodeById]);

  const filteredUnresolvedGenres = useMemo(() => {
    if (!unresolvedGenres) return [];
    if (!search.trim()) return unresolvedGenres;
    const q = search.toLowerCase();
    return unresolvedGenres.filter((r) => r.raw_value.toLowerCase().includes(q));
  }, [unresolvedGenres, search]);

  // When showing all, sort A–Z for alpha grouping; otherwise keep frequency order
  const sortedRows = useMemo(() => {
    if (!showAll) return rows;
    return [...rows].sort((a, b) =>
      a.raw_value.localeCompare(b.raw_value, undefined, { sensitivity: "base" })
    );
  }, [rows, showAll]);

  const alphaGroups = useMemo(
    () => showAll ? groupByFirstLetter(sortedRows) : null,
    [showAll, sortedRows]
  );

  const unmappedCount = useMemo(
    () => vocab?.filter((r) => !r.canonical_id || r.canonical_id === ACCEPTED || r.canonical_id === IGNORED).length ?? 0,
    [vocab]
  );

  function renderUnresolvedRow(row: UnresolvedGenreRow) {
    return (
      <tr key={`unresolved-${row.raw_value}:${row.kind}`} className="tags-row--unmapped">
        <td className="tags-cell-raw">{row.raw_value}</td>
        <td><span className={`tags-kind-badge tags-kind-badge--${row.kind}`}>{row.kind}</span></td>
        <td className="tags-cell-count">{row.album_count} {row.album_count === 1 ? "album" : "albums"}</td>
        <td className="tags-cell-sources">{row.sources}</td>
        <td className="tags-cell-mapping" colSpan={2}>
          <div className="tags-cell-mapping-row">
            <CanonCombobox
              treeNodes={treeNodes}
              currentId={null}
              onSelect={(canonicalId) =>
                saveMapping.mutate({ rawValue: row.raw_value, kind: row.kind, canonicalId })
              }
              onClear={() => {}}
            />
            <button
              className="tags-accept-btn"
              onClick={() => saveMapping.mutate({ rawValue: row.raw_value, kind: row.kind, canonicalId: ACCEPTED })}
              title="Accept this tag as-is"
            >
              Accept
            </button>
            <button
              className="tags-accept-btn tags-ignore-btn"
              onClick={() => saveMapping.mutate({ rawValue: row.raw_value, kind: row.kind, canonicalId: IGNORED })}
              title="Ignore this tag — exclude from genre output"
            >
              Ignore
            </button>
          </div>
        </td>
      </tr>
    );
  }

  function renderRow(row: VocabRow) {
    const dot = mappingDot(row, nodeById);
    const section = resolvedSection(row, nodeById);
    const isLocked = row.locked === 1;
    const isMapped = row.canonical_id && row.canonical_id !== ACCEPTED && row.canonical_id !== IGNORED;

    return (
      <tr key={`${row.raw_value}:${row.kind}`} className={row.canonical_id ? "" : "tags-row--unmapped"}>
        <td
          className="tags-cell-raw tags-cell-raw--clickable"
          onClick={() => setSearch(row.raw_value)}
          title="Filter to this tag"
        >{row.raw_value}</td>
        <td>{<span className={`tags-kind-badge tags-kind-badge--${section}`}>{section}</span>}</td>
        <td className="tags-cell-count">{row.track_count}</td>
        <td className="tags-cell-dot">
          {dot && <span className={`tags-dot tags-dot--${dot.color}`} title={dot.title} />}
        </td>
        <td className="tags-cell-mapping">
          {row.canonical_id === ACCEPTED ? (
            <div className="tags-mapped">
              <span className="tags-mapped-name tags-mapped-accepted">Accepted as-is</span>
              {!isLocked && (
                <button
                  className="tags-clear-btn"
                  onClick={() => deleteMapping.mutate({ rawValue: row.raw_value, kind: row.kind as TagKind })}
                  title="Remove acceptance"
                >×</button>
              )}
            </div>
          ) : row.canonical_id === IGNORED ? (
            <div className="tags-mapped">
              <span className="tags-mapped-name tags-mapped-ignored">Ignored</span>
              {!isLocked && (
                <button
                  className="tags-clear-btn"
                  onClick={() => deleteMapping.mutate({ rawValue: row.raw_value, kind: row.kind as TagKind })}
                  title="Remove ignore"
                >×</button>
              )}
            </div>
          ) : (
            <div className="tags-cell-mapping-row">
              {isLocked ? (
                <span className="tags-mapped-name">{nodeById.get(row.canonical_id ?? "")?.name ?? row.canonical_id}</span>
              ) : (
                <CanonCombobox
                  treeNodes={treeNodes}
                  currentId={row.canonical_id}
                  onSelect={(canonicalId) =>
                    saveMapping.mutate({ rawValue: row.raw_value, kind: row.kind as TagKind, canonicalId })
                  }
                  onClear={() =>
                    deleteMapping.mutate({ rawValue: row.raw_value, kind: row.kind as TagKind })
                  }
                />
              )}
              {!row.canonical_id && !isLocked && (
                <>
                  <button
                    className="tags-accept-btn"
                    onClick={() =>
                      saveMapping.mutate({ rawValue: row.raw_value, kind: row.kind as TagKind, canonicalId: ACCEPTED })
                    }
                    title="Accept this tag as-is"
                  >
                    Accept
                  </button>
                  <button
                    className="tags-accept-btn tags-ignore-btn"
                    onClick={() =>
                      saveMapping.mutate({ rawValue: row.raw_value, kind: row.kind as TagKind, canonicalId: IGNORED })
                    }
                    title="Ignore this tag — exclude from genre output"
                  >
                    Ignore
                  </button>
                </>
              )}
            </div>
          )}
        </td>
        <td className="tags-cell-lock">
          {isMapped && (
            <button
              className={`tags-lock-btn${isLocked ? " tags-lock-btn--locked" : ""}`}
              title={isLocked ? "Unlock mapping" : "Lock mapping (prevents auto-map overwrite)"}
              onClick={() => lockMapping.mutate({ rawValue: row.raw_value, kind: row.kind as TagKind, locked: !isLocked })}
            >
              {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <main className="tags-view">
      <header className="tags-header">
        <div className="tags-header-left">
          <h1>Tag Vocabulary</h1>
          {unmappedCount > 0 && (
            <span className="tags-unmapped-badge">{unmappedCount} unmapped</span>
          )}
        </div>
        <div className="tags-header-controls">
          <input
            className="tags-search"
            placeholder="Filter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className={`tags-toggle-btn${showAll ? " tags-toggle-btn--active" : ""}`}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Unmapped only" : "Show all"}
          </button>
        </div>
      </header>

      {filteredUnresolvedGenres.length > 0 && (
        <section className="tags-review-section">
          <h2 className="tags-review-title">
            Needs Review
            <span className="tags-unmapped-badge">{filteredUnresolvedGenres.length}</span>
          </h2>
          <p className="tags-review-desc">
            These tags came from Last.fm or MusicBrainz but couldn&apos;t be matched to the canon tree. Map them to a canon node, accept as-is, or ignore.
          </p>
          <table className="tags-table">
            <thead>
              <tr>
                <th>Raw value</th>
                <th>Kind</th>
                <th>Albums</th>
                <th>Source</th>
                <th colSpan={2}>Maps to</th>
              </tr>
            </thead>
            <tbody>
              {filteredUnresolvedGenres.map((row) => renderUnresolvedRow(row))}
            </tbody>
          </table>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="tags-empty">
          {unmappedCount === 0 ? "All tags are mapped." : "No tags match filter."}
        </p>
      ) : (
        <table className="tags-table">
          <thead>
            <tr>
              <th>Raw value</th>
              <th>Section</th>
              <th>Tracks</th>
              <th></th>
              <th>Maps to</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {alphaGroups ? (
              alphaGroups.map(({ letter, rows: letterRows }) => (
                <Fragment key={`alpha-${letter}`}>
                  <tr className="tags-alpha-header">
                    <td colSpan={6}>{letter}</td>
                  </tr>
                  {letterRows.map((row) => renderRow(row))}
                </Fragment>
              ))
            ) : (
              sortedRows.map((row) => renderRow(row))
            )}
          </tbody>
        </table>
      )}
      {showAll && !showTrivial && trivialCount > 0 && (
        <p className="tags-trivial-note">
          {trivialCount} trivially exact-matched {trivialCount === 1 ? "tag" : "tags"} hidden —{" "}
          <button className="tags-trivial-show-btn" onClick={() => setShowTrivial(true)}>show them</button>
        </p>
      )}
    </main>
  );
}
