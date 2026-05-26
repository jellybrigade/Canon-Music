import { useState, useRef, useCallback } from "react";
import { Search, X, Music, Smile, AlertTriangle, ChevronRight, ChevronDown, Plus } from "lucide-react";
import { useVocabulary, useVocabAlbums, useTagMappings, useAddUserTreeNode } from "../../hooks/useTagMappings";
import { CanonCombobox } from "./CanonCombobox";
import { canonicalKey } from "../../lib/canonicalize";
import type { VocabRow } from "../../hooks/useTagMappings";
import type { TagKind, TreeNode } from "../../lib/canonicalize";

type FilterState = "all" | "canonical" | "mapped" | "off-tree";

function tagState(row: VocabRow): "canonical" | "mapped" | "off-tree" {
  if (row.canonical_id) return "canonical";
  return "off-tree";
}

interface DetailPanelProps {
  row: VocabRow;
  onClose: () => void;
}

function DetailPanel({ row, onClose }: DetailPanelProps) {
  const { data: albums, isLoading } = useVocabAlbums(row.raw_value, row.kind);
  const { saveMapping, deleteMapping } = useTagMappings();
  const addUserNode = useAddUserTreeNode();
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [addToTreeName, setAddToTreeName] = useState("");
  const [showAddToTree, setShowAddToTree] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  async function handleRename() {
    if (!selectedNode) return;
    await saveMapping.mutateAsync({ rawValue: row.raw_value, kind: row.kind, canonicalId: selectedNode.id });
    setSaveMsg("Renamed");
    setTimeout(() => setSaveMsg(""), 2000);
  }

  async function handleAddToTree() {
    const name = addToTreeName.trim() || row.raw_value;
    const key = canonicalKey(name);
    await addUserNode.mutateAsync({
      id: `user-${key}`,
      name,
      type: row.kind,
      canonical_key: key,
      parent_ids: [],
    });
    setSaveMsg("Added to canon tree");
    setTimeout(() => setSaveMsg(""), 2000);
  }

  return (
    <div className="vocab-detail">
      <div className="vocab-detail-header">
        <div className="vocab-detail-title">
          {row.kind === "genre" ? <Music size={14} /> : <Smile size={14} />}
          <strong>{row.raw_value}</strong>
          <span className="vocab-detail-count">{row.track_count} track{row.track_count !== 1 ? "s" : ""}</span>
        </div>
        <button className="vocab-detail-close" onClick={onClose}><X size={14} /></button>
      </div>

      <div className="vocab-detail-section">
        <label className="vocab-detail-label">Map to canonical</label>
        <div className="vocab-detail-combobox-row">
          <CanonCombobox
            value={row.canonical_id ? "" : ""}
            kind={row.kind}
            onChange={(_, node) => setSelectedNode(node)}
            placeholder={`Search ${row.kind}s…`}
          />
          <button
            className="vocab-detail-save-btn"
            disabled={!selectedNode || saveMapping.isPending}
            onClick={() => void handleRename()}
          >
            Rename all
          </button>
        </div>
        {saveMsg && <span className="vocab-detail-msg">{saveMsg}</span>}
      </div>

      {!row.canonical_id && (
        <div className="vocab-detail-section">
          <button
            className="vocab-detail-link"
            onClick={() => setShowAddToTree((v) => !v)}
          >
            <Plus size={12} /> Add "{row.raw_value}" to canon tree
          </button>
          {showAddToTree && (
            <div className="vocab-add-tree">
              <input
                className="vocab-add-tree-input"
                value={addToTreeName}
                placeholder={row.raw_value}
                onChange={(e) => setAddToTreeName(e.target.value)}
              />
              <button
                className="vocab-detail-save-btn"
                onClick={() => void handleAddToTree()}
                disabled={addUserNode.isPending}
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}

      <div className="vocab-detail-section">
        <button
          className="vocab-detail-link"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Affected albums ({albums?.length ?? "…"})
        </button>
        {expanded && (
          <div className="vocab-albums">
            {isLoading && <span className="vocab-loading">Loading…</span>}
            {albums?.map((a) => (
              <div key={a.album_id} className="vocab-album-row">
                <span className="vocab-album-name">{a.album_name}</span>
                <span className="vocab-album-count">{a.track_count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {row.canonical_id && (
        <div className="vocab-detail-section">
          <button
            className="vocab-detail-danger"
            onClick={() => void deleteMapping.mutateAsync({ rawValue: row.raw_value, kind: row.kind })}
            disabled={deleteMapping.isPending}
          >
            Remove mapping
          </button>
        </div>
      )}
    </div>
  );
}

export function VocabularyPanel() {
  const { data: vocab, isLoading } = useVocabulary();
  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState<FilterState>("all");
  const [filterKind, setFilterKind] = useState<TagKind | "all">("all");
  const [selected, setSelected] = useState<VocabRow | null>(null);

  const VIRTUAL_ROW_HEIGHT = 36;
  const VISIBLE_ROWS = 20;
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = (vocab ?? []).filter((row) => {
    if (filterKind !== "all" && row.kind !== filterKind) return false;
    if (filterState !== "all" && tagState(row) !== filterState) return false;
    if (search && !row.raw_value.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const startIdx = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - 2);
  const endIdx = Math.min(filtered.length, startIdx + VISIBLE_ROWS + 4);
  const visibleRows = filtered.slice(startIdx, endIdx);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const stateFilters: [FilterState, string][] = [
    ["all", "All"],
    ["canonical", "Canonical"],
    ["off-tree", "Off-tree"],
  ];

  const kindFilters: [TagKind | "all", string][] = [
    ["all", "All"],
    ["genre", "Genres"],
    ["mood", "Moods"],
  ];

  return (
    <div className="vocab-panel">
      <div className="vocab-list-pane">
        <div className="vocab-toolbar">
          <div className="vocab-search-wrap">
            <Search size={13} className="vocab-search-icon" />
            <input
              className="vocab-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tags…"
            />
            {search && (
              <button className="vocab-search-clear" onClick={() => setSearch("")}><X size={12} /></button>
            )}
          </div>
          <div className="vocab-filters">
            {kindFilters.map(([k, label]) => (
              <button
                key={k}
                className={`sort-btn${filterKind === k ? " sort-btn--active" : ""}`}
                onClick={() => setFilterKind(k)}
              >
                {label}
              </button>
            ))}
            <span className="vocab-filter-sep" />
            {stateFilters.map(([s, label]) => (
              <button
                key={s}
                className={`sort-btn${filterState === s ? " sort-btn--active" : ""}`}
                onClick={() => setFilterState(s)}
              >
                {s === "off-tree" && <AlertTriangle size={11} />}
                {label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="vocab-loading-state">Loading…</div>
        ) : (
          <div
            ref={scrollRef}
            className="vocab-virtual-scroll"
            style={{ height: Math.min(filtered.length, VISIBLE_ROWS) * VIRTUAL_ROW_HEIGHT }}
            onScroll={handleScroll}
          >
            <div style={{ height: filtered.length * VIRTUAL_ROW_HEIGHT, position: "relative" }}>
              {visibleRows.map((row, i) => {
                const state = tagState(row);
                const isSelected = selected?.raw_value === row.raw_value && selected?.kind === row.kind;
                return (
                  <div
                    key={`${row.raw_value}:${row.kind}`}
                    className={`vocab-row${isSelected ? " vocab-row--selected" : ""}`}
                    style={{
                      position: "absolute",
                      top: (startIdx + i) * VIRTUAL_ROW_HEIGHT,
                      height: VIRTUAL_ROW_HEIGHT,
                      width: "100%",
                    }}
                    onClick={() => setSelected(isSelected ? null : row)}
                  >
                    <span className="vocab-kind-icon">
                      {row.kind === "genre" ? <Music size={12} /> : <Smile size={12} />}
                    </span>
                    <span className="vocab-raw-value">{row.raw_value}</span>
                    <span className="vocab-track-count">{row.track_count}</span>
                    <span className={`vocab-state-badge vocab-state-badge--${state}`}>
                      {state === "off-tree" && <AlertTriangle size={10} />}
                      {state}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="vocab-empty">No tags match filters.</div>
        )}
      </div>

      {selected && (
        <div className="vocab-detail-pane">
          <DetailPanel row={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}
