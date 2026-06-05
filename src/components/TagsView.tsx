import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Unlock, ChevronLeft, ChevronRight, Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import {
  useVocabulary,
  useTagMappings,
  useAutoMapExact,
  useUnresolvedGenres,
  useVocabAlbums,
  useUnresolvedAlbums,
} from "../hooks/useTagMappings";
import type { UnresolvedGenreRow, VocabRow } from "../hooks/useTagMappings";
import { getCanonTree, canonicalKey } from "../lib/canonicalize";
import type { TreeNode, TagKind } from "../lib/canonicalize";
import {
  useUserNodes,
  useCreateUserNode,
  useUpdateUserNode,
  useDeleteUserNode,
  useUserTreeChangelog,
  isSuperseeded,
} from "../hooks/useUserTree";
import type { UserTreeNode } from "../hooks/useUserTree";
import { useServers, useServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl } from "../lib/navidrome";
import "./TagsView.css";

const ACCEPTED = "__accepted__";
const IGNORED = "__ignored__";

// ── Combobox ──────────────────────────────────────────────────────────────────

interface ComboboxProps {
  treeNodes: TreeNode[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  onCreateNode?: (name: string) => void;
}

function CanonCombobox({ treeNodes, currentId, onSelect, onClear, onCreateNode }: ComboboxProps) {
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

  // Only offer "create" when query has content and no exact name match
  const canCreate = onCreateNode && query.trim().length > 0 &&
    !treeNodes.some((n) => n.name.toLowerCase() === query.trim().toLowerCase());

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

  const showDropdown = open && (matches.length > 0 || canCreate);

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
      {showDropdown && createPortal(
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
          {canCreate && (
            <button
              className="tags-combobox-option tags-combobox-create"
              onMouseDown={(e) => {
                e.preventDefault();
                onCreateNode!(query.trim());
                setQuery("");
                setOpen(false);
              }}
            >
              <Plus size={12} />
              <span className="tags-option-name">Create "{query.trim()}"</span>
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Album art strip ───────────────────────────────────────────────────────────

type ArtAlbum = { album_id: string; album_name: string; artwork_url: string | null };

function AlbumArtStrip({ albums, size = 40 }: { albums: ArtAlbum[]; size?: number }) {
  const { data: servers } = useServers();
  const { data: swc } = useServerWithCredential(servers?.[0]?.id);

  const tiles = albums
    .map((a) => ({
      ...a,
      url: swc && a.artwork_url
        ? getCoverArtUrl(swc.server.url, swc.server.username, swc.credential, a.artwork_url, size * 2)
        : null,
    }))
    .filter((a) => a.url);

  if (!tiles.length) return null;

  return (
    <div className="tags-art-strip">
      {tiles.map((a) => (
        <div
          key={a.album_id}
          className="tags-art-thumb"
          title={a.album_name}
          style={{ width: size, height: size }}
        >
          <img src={a.url!} alt="" width={size} height={size} loading="lazy" decoding="async" />
        </div>
      ))}
    </div>
  );
}

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: "auto" | "manual" | null }) {
  if (!source) return null;
  return (
    <span className={`tags-source-badge tags-source-badge--${source}`}>
      {source === "auto" ? "AUTO" : "MANUAL"}
    </span>
  );
}

// ── Segmented toggle ──────────────────────────────────────────────────────────

interface SegOption { value: string; label: string }

function SegToggle({ value, options, onChange }: {
  value: string;
  options: SegOption[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="tags-seg">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`tags-seg-btn${value === opt.value ? " tags-seg-btn--active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

type KindFilter = "all" | "genre" | "mood";
type SourceFilter = "all" | "auto" | "manual";

const KIND_OPTIONS: SegOption[] = [
  { value: "all", label: "All" },
  { value: "genre", label: "Genre" },
  { value: "mood", label: "Mood" },
];

const SOURCE_OPTIONS: SegOption[] = [
  { value: "all", label: "All" },
  { value: "auto", label: "Auto" },
  { value: "manual", label: "Manual" },
];

interface FilterBarProps {
  search: string;
  onSearch: (s: string) => void;
  kind: KindFilter;
  onKind: (k: KindFilter) => void;
  source?: SourceFilter;
  onSource?: (s: SourceFilter) => void;
  sort?: string;
  sortOptions?: SegOption[];
  onSort?: (s: string) => void;
}

// fallow-ignore-next-line complexity
function TagFilterBar({ search, onSearch, kind, onKind, source, onSource, sort, sortOptions, onSort }: FilterBarProps) {
  return (
    <div className="tags-filter-bar">
      <input
        className="tags-search"
        placeholder="Filter…"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <SegToggle value={kind} options={KIND_OPTIONS} onChange={(v) => onKind(v as KindFilter)} />
      {onSource && source !== undefined && (
        <SegToggle value={source} options={SOURCE_OPTIONS} onChange={(v) => onSource(v as SourceFilter)} />
      )}
      {onSort && sortOptions && sort !== undefined && (
        <SegToggle value={sort} options={sortOptions} onChange={onSort} />
      )}
    </div>
  );
}

// ── Review card (grid mode) ───────────────────────────────────────────────────

interface ReviewCardProps {
  row: UnresolvedGenreRow;
  treeNodes: TreeNode[];
  onMap: (rawValue: string, kind: TagKind, canonicalId: string) => void;
  onAccept: (rawValue: string, kind: TagKind) => void;
  onIgnore: (rawValue: string, kind: TagKind) => void;
  onCreateNode: (name: string, rawValue: string, rawKind: TagKind) => void;
}

function TagReviewCard({ row, treeNodes, onMap, onAccept, onIgnore, onCreateNode }: ReviewCardProps) {
  const { data: albums = [] } = useUnresolvedAlbums(row.raw_value, row.kind);

  return (
    <div className="tags-review-card">
      <div className="tags-card-header">
        <span className="tags-card-title">{row.raw_value}</span>
        <span className={`tags-kind-badge tags-kind-badge--${row.kind}`}>{row.kind}</span>
      </div>
      <div className="tags-card-meta">
        {row.album_count} {row.album_count === 1 ? "album" : "albums"}
        {row.sources && <span className="tags-card-source"> · {row.sources}</span>}
      </div>
      <AlbumArtStrip albums={albums.slice(0, 3)} />
      <CanonCombobox
        treeNodes={treeNodes}
        currentId={null}
        onSelect={(id) => onMap(row.raw_value, row.kind, id)}
        onClear={() => {}}
        onCreateNode={(name) => onCreateNode(name, row.raw_value, row.kind)}
      />
      <div className="tags-card-actions">
        <button
          className="tags-card-btn tags-card-btn--accept"
          title="Accept this tag as-is — use in genre output without remapping"
          onClick={() => onAccept(row.raw_value, row.kind)}
        >
          Accept
        </button>
        <button
          className="tags-card-btn tags-card-btn--ignore"
          title="Ignore this tag — exclude from genre output"
          onClick={() => onIgnore(row.raw_value, row.kind)}
        >
          Ignore
        </button>
      </div>
    </div>
  );
}

// ── Focus card (focus mode) ───────────────────────────────────────────────────

interface FocusCardProps {
  row: UnresolvedGenreRow;
  index: number;
  total: number;
  treeNodes: TreeNode[];
  onMap: (rawValue: string, kind: TagKind, canonicalId: string) => void;
  onAccept: (rawValue: string, kind: TagKind) => void;
  onIgnore: (rawValue: string, kind: TagKind) => void;
  onNext: () => void;
  onPrev: () => void;
  onCreateNode: (name: string, rawValue: string, rawKind: TagKind) => void;
}

function TagFocusCard({ row, index, total, treeNodes, onMap, onAccept, onIgnore, onNext, onPrev, onCreateNode }: FocusCardProps) {
  const { data: albums = [] } = useUnresolvedAlbums(row.raw_value, row.kind);

  useEffect(() => {
    // fallow-ignore-next-line complexity
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "a" || e.key === "A") { e.preventDefault(); onAccept(row.raw_value, row.kind); }
      if (e.key === "i" || e.key === "I") { e.preventDefault(); onIgnore(row.raw_value, row.kind); }
      if (e.key === "ArrowRight" || e.key === "s" || e.key === "S") { e.preventDefault(); onNext(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); onPrev(); }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [row.raw_value, row.kind, onAccept, onIgnore, onNext, onPrev]);

  return (
    <div className="tags-focus-card">
      <div className="tags-focus-meta">
        <div className="tags-focus-meta-top">
          <span className="tags-focus-raw">{row.raw_value}</span>
          <span className={`tags-kind-badge tags-kind-badge--${row.kind}`}>{row.kind}</span>
        </div>
        <span className="tags-focus-impact">
          {row.album_count} {row.album_count === 1 ? "album" : "albums"}
          {row.sources && <span className="tags-focus-sources"> · {row.sources}</span>}
        </span>
      </div>
      <AlbumArtStrip albums={albums} size={64} />
      <div className="tags-focus-map-section">
        <span className="tags-focus-map-label">Map to canon</span>
        <CanonCombobox
          treeNodes={treeNodes}
          currentId={null}
          onSelect={(id) => onMap(row.raw_value, row.kind, id)}
          onClear={() => {}}
          onCreateNode={(name) => onCreateNode(name, row.raw_value, row.kind)}
        />
      </div>
      <div className="tags-focus-actions">
        <button
          className="tags-focus-btn tags-focus-btn--accept"
          onClick={() => onAccept(row.raw_value, row.kind)}
          title="Accept this tag as-is"
        >
          Accept <span className="tags-focus-hint">A</span>
        </button>
        <button
          className="tags-focus-btn tags-focus-btn--ignore"
          onClick={() => onIgnore(row.raw_value, row.kind)}
          title="Exclude from genre output"
        >
          Ignore <span className="tags-focus-hint">I</span>
        </button>
      </div>
      <div className="tags-focus-nav">
        <button
          className="tags-focus-nav-btn"
          onClick={onPrev}
          disabled={index === 0}
        >
          <div className="tags-focus-nav-icon"><ChevronLeft size={13} /></div>
          Prev
        </button>
        <span className="tags-focus-pos">{index + 1} / {total}</span>
        <button
          className="tags-focus-nav-btn"
          onClick={onNext}
          disabled={index >= total - 1}
        >
          Skip
          <div className="tags-focus-nav-icon"><ChevronRight size={13} /></div>
        </button>
      </div>
    </div>
  );
}

// ── Mapped group ──────────────────────────────────────────────────────────────

interface MappedGroup {
  canonicalId: string;
  node: TreeNode;
  variants: VocabRow[];   // sorted by track_count desc
  totalTracks: number;
}

interface MappedGroupProps {
  group: MappedGroup;
  onDelete: (rawValue: string, kind: TagKind) => void;
  onLock: (rawValue: string, kind: TagKind, locked: boolean) => void;
}

// fallow-ignore-next-line complexity
function TagMappedGroup({ group, onDelete, onLock }: MappedGroupProps) {
  const primaryVariant = group.variants[0];
  const { data: albums = [] } = useVocabAlbums(primaryVariant?.raw_value ?? "", primaryVariant?.kind ?? "genre");
  const isLocked = group.variants.every((v) => v.locked === 1);

  if (!primaryVariant) return null;

  const aliasVariants = group.variants.filter((v) => v.raw_value !== group.node.name);

  function toggleLock() {
    for (const v of group.variants) {
      onLock(v.raw_value, v.kind, !isLocked);
    }
  }

  return (
    <div className="tags-mapped-group">
      <div className="tags-mapped-group-main">
        <div className="tags-mapped-group-left">
          <span className="tags-mapped-group-name">{group.node.name}</span>
          <span className="tags-track-count">
            {group.totalTracks} {group.totalTracks === 1 ? "track" : "tracks"}
          </span>
        </div>
        <AlbumArtStrip albums={albums.slice(0, 3) as ArtAlbum[]} />
        <div className="tags-mapped-group-actions">
          <button
            className={`tags-lock-btn${isLocked ? " tags-lock-btn--locked" : ""}`}
            onClick={toggleLock}
            title={isLocked ? "Unlock mapping" : "Lock (prevents auto-remap)"}
          >
            {isLocked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
        </div>
      </div>
      {aliasVariants.length > 0 && (
        <div className="tags-mapped-aliases">
          {aliasVariants.map((v) => (
            <span key={`${v.raw_value}:${v.kind}`} className="tags-alias-chip">
              <span className="tags-alias-name">{v.raw_value}</span>
              <button
                className="tags-alias-remove"
                title="Unmap this alias"
                onClick={() => onDelete(v.raw_value, v.kind)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── List row (resolved / cleanup) ─────────────────────────────────────────────

interface ListRowProps {
  row: VocabRow;
  nodeById: Map<string, TreeNode>;
  showUndo?: boolean;
  showDelete?: boolean;
  showLock?: boolean;
  isOrphan?: boolean;
  onUndo?: () => void;
  onDelete?: () => void;
  onLock?: () => void;
}

// fallow-ignore-next-line complexity
function TagListRow({ row, nodeById, showUndo, showDelete, showLock, isOrphan, onUndo, onDelete, onLock }: ListRowProps) {
  const { data: albums = [] } = useVocabAlbums(row.raw_value, row.kind);
  const isLocked = row.locked === 1;
  const mappedNode = row.canonical_id && row.canonical_id !== ACCEPTED && row.canonical_id !== IGNORED
    ? nodeById.get(row.canonical_id)
    : null;
  // Show canonical node's type (genre/mood/descriptor/scene) when known; raw kind as fallback
  const displayKind = mappedNode?.type ?? row.kind;

  return (
    <div className="tags-list-row">
      <div className="tags-list-left">
        <span className="tags-cell-raw">{row.raw_value}</span>
        <span className={`tags-kind-badge tags-kind-badge--${displayKind}`}>{displayKind}</span>
        {!isOrphan && (
          <span className="tags-track-count">
            {row.track_count} {row.track_count === 1 ? "track" : "tracks"}
          </span>
        )}
      </div>
      {!isOrphan && <AlbumArtStrip albums={albums.slice(0, 3) as ArtAlbum[]} />}
      <div className="tags-list-mapping">
        {mappedNode && (
          <>
            <span className="tags-mapped-name">{mappedNode.name}</span>
            <SourceBadge source={row.mapping_source} />
          </>
        )}
        {row.canonical_id === ACCEPTED && <span className="tags-mapped-accepted">Accepted as-is</span>}
        {row.canonical_id === IGNORED && <span className="tags-mapped-ignored">Ignored</span>}
      </div>
      <div className="tags-list-actions">
        {showLock && mappedNode && (
          <button
            className={`tags-lock-btn${isLocked ? " tags-lock-btn--locked" : ""}`}
            onClick={onLock}
            title={isLocked ? "Unlock mapping" : "Lock (prevents auto-remap)"}
          >
            {isLocked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
        )}
        {showUndo && (
          <button className="tags-undo-btn" onClick={onUndo}>Undo</button>
        )}
        {showDelete && (
          <button className="tags-delete-btn" onClick={onDelete} title="Remove mapping">×</button>
        )}
      </div>
    </div>
  );
}

// ── Resolved column list ──────────────────────────────────────────────────────

interface ResolvedTagListProps {
  rows: VocabRow[];
  nodeById: Map<string, TreeNode>;
  onUndo: (row: VocabRow) => void;
}

function ResolvedTagList({ rows, nodeById, onUndo }: ResolvedTagListProps) {
  if (rows.length === 0) return <p className="tags-resolved-empty">None</p>;
  return (
    <div className="tags-list">
      {rows.map((row) => (
        <TagListRow
          key={`${row.raw_value}:${row.kind}`}
          row={row}
          nodeById={nodeById}
          showUndo
          onUndo={() => onUndo(row)}
        />
      ))}
    </div>
  );
}

// ── Create / edit node modal ──────────────────────────────────────────────────

interface NodeFormState {
  name: string;
  type: "genre" | "mood" | "category";
  parentId: string;
}

interface NodeModalProps {
  initialName?: string;
  editingNode?: UserTreeNode;
  treeNodes: TreeNode[];
  onSave: (state: NodeFormState) => void;
  onCancel: () => void;
  error?: string;
}

function NodeModal({ initialName = "", editingNode, treeNodes, onSave, onCancel, error }: NodeModalProps) {
  const [name, setName] = useState(editingNode?.name ?? initialName);
  const [type, setType] = useState<"genre" | "mood" | "category">(editingNode?.type ?? "genre");
  const [parentId, setParentId] = useState<string>(
    editingNode ? (JSON.parse(editingNode.parent_ids) as string[])[0] ?? "" : ""
  );
  const [parentQuery, setParentQuery] = useState("");
  const [parentOpen, setParentOpen] = useState(false);
  const [parentDropStyle, setParentDropStyle] = useState<React.CSSProperties>({});
  const parentInputRef = useRef<HTMLInputElement>(null);
  const parentWrapRef = useRef<HTMLDivElement>(null);

  const parentMatches = useMemo(() => {
    if (!parentQuery.trim()) return [];
    const q = parentQuery.toLowerCase();
    return treeNodes
      .filter((n) => n.name.toLowerCase().includes(q) || n.canonical_key.toLowerCase().includes(q))
      .slice(0, 8);
  }, [treeNodes, parentQuery]);

  const parentNode = treeNodes.find((n) => n.id === parentId) ?? null;

  function openParentDrop() {
    if (parentInputRef.current) {
      const rect = parentInputRef.current.getBoundingClientRect();
      setParentDropStyle({ position: "fixed", top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 220), zIndex: 10000 });
    }
    setParentOpen(true);
  }

  useEffect(() => {
    if (!parentOpen) return;
    function onDown(e: MouseEvent) {
      if (parentWrapRef.current && !parentWrapRef.current.contains(e.target as Node)) {
        setParentOpen(false);
        setParentQuery("");
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [parentOpen]);

  const previewKey = canonicalKey(name);

  return createPortal(
    <div className="node-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="node-modal">
        <h3 className="node-modal-title">{editingNode ? "Edit node" : "Create new node"}</h3>

        <label className="node-modal-label">
          Name
          <input
            className="node-modal-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSave({ name: name.trim(), type, parentId }); } if (e.key === "Escape") onCancel(); }}
          />
          {name.trim() && (
            <span className="node-modal-key-preview">key: {previewKey}</span>
          )}
        </label>

        <label className="node-modal-label">
          Type
          <div className="tags-seg node-modal-seg">
            {(["genre", "mood", "category"] as const).map((t) => (
              <button
                key={t}
                className={`tags-seg-btn${type === t ? " tags-seg-btn--active" : ""}`}
                onClick={() => setType(t)}
              >{t}</button>
            ))}
          </div>
        </label>

        <label className="node-modal-label">
          Parent <span className="node-modal-optional">(optional)</span>
          {parentNode ? (
            <div className="tags-mapped" style={{ marginTop: 4 }}>
              <span className="tags-mapped-name">{parentNode.name}</span>
              <button className="tags-clear-btn" onClick={() => { setParentId(""); setParentQuery(""); }}>×</button>
            </div>
          ) : (
            <div className="tags-combobox" ref={parentWrapRef} style={{ marginTop: 4 }}>
              <input
                ref={parentInputRef}
                className="tags-combobox-input"
                placeholder="Search for parent node…"
                value={parentQuery}
                onChange={(e) => { setParentQuery(e.target.value); openParentDrop(); }}
                onFocus={openParentDrop}
              />
              {parentOpen && parentMatches.length > 0 && createPortal(
                <div className="tags-combobox-dropdown" style={parentDropStyle}>
                  {parentMatches.map((n) => (
                    <button
                      key={n.id}
                      className="tags-combobox-option"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setParentId(n.id);
                        setParentQuery("");
                        setParentOpen(false);
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
          )}
        </label>

        {error && <p className="node-modal-error">{error}</p>}

        <div className="node-modal-actions">
          <button className="node-modal-btn node-modal-btn--cancel" onClick={onCancel}>Cancel</button>
          <button
            className="node-modal-btn node-modal-btn--save"
            disabled={!name.trim()}
            onClick={() => onSave({ name: name.trim(), type, parentId })}
          >
            {editingNode ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Tree node row ─────────────────────────────────────────────────────────────

interface TreeNodeRowProps {
  node: UserTreeNode;
  treeNodes: TreeNode[];
  onEdit: (node: UserTreeNode) => void;
  onDelete: (node: UserTreeNode) => void;
}

function UserNodeRow({ node, treeNodes, onEdit, onDelete }: TreeNodeRowProps) {
  const parentIds = JSON.parse(node.parent_ids) as string[];
  const parentName = parentIds[0] ? (treeNodes.find((n) => n.id === parentIds[0])?.name ?? parentIds[0]) : null;
  const superseded = isSuperseeded(node);

  return (
    <div className={`tree-node-row${superseded ? " tree-node-row--superseded" : ""}`}>
      <div className="tree-node-row-left">
        <span className="tree-node-name">{node.name}</span>
        <span className={`tags-kind-badge tags-kind-badge--${node.type}`}>{node.type}</span>
        {parentName && <span className="tree-node-parent">↳ {parentName}</span>}
        {superseded && (
          <span className="tree-node-conflict" title="A node with this key now exists in the bundled tree — you can delete this duplicate">
            <AlertTriangle size={12} /> bundled
          </span>
        )}
      </div>
      <div className="tree-node-row-actions">
        <button className="tree-node-action-btn" onClick={() => onEdit(node)} title="Edit"><Pencil size={13} /></button>
        <button className="tree-node-action-btn tree-node-action-btn--danger" onClick={() => onDelete(node)} title="Delete"><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

type TabId = "review" | "mapped" | "resolved" | "cleanup" | "tree";
type ViewMode = "focus" | "grid";
const PAGE_SIZE = 24;

function applyKindFilter<T extends { kind: TagKind }>(rows: T[], kind: KindFilter): T[] {
  return kind === "all" ? rows : rows.filter((r) => r.kind === kind);
}
function applySearch<T extends { raw_value: string }>(rows: T[], search: string): T[] {
  if (!search.trim()) return rows;
  const q = search.toLowerCase();
  return rows.filter((r) => r.raw_value.toLowerCase().includes(q));
}

// fallow-ignore-next-line complexity
export function TagsView() {
  const { data: vocab } = useVocabulary();
  const { data: unresolvedGenres } = useUnresolvedGenres();
  const { saveMapping, deleteMapping, lockMapping } = useTagMappings();
  const autoMapExact = useAutoMapExact();
  const { data: userNodes = [] } = useUserNodes();
  const { data: changelog = [] } = useUserTreeChangelog();
  const createUserNode = useCreateUserNode();
  const updateUserNode = useUpdateUserNode();
  const deleteUserNode = useDeleteUserNode();
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [tab, setTab] = useState<TabId>("review");
  const [autoMapSummary, setAutoMapSummary] = useState<{ mapped: number; remaining: number } | null>(null);

  // node create/edit modal
  interface PendingCreate { name: string; rawValue?: string; rawKind?: TagKind }
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [editingNode, setEditingNode] = useState<UserTreeNode | null>(null);
  const [nodeModalError, setNodeModalError] = useState<string | undefined>();
  const [deletingNode, setDeletingNode] = useState<UserTreeNode | null>(null);

  // review
  const [reviewMode, setReviewMode] = useState<ViewMode>("grid");
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewKind, setReviewKind] = useState<KindFilter>("all");
  const [reviewSort, setReviewSort] = useState<"impact" | "az">("impact");
  const [focusIdx, setFocusIdx] = useState(0);
  const [gridPages, setGridPages] = useState(false);
  const [gridPage, setGridPage] = useState(1);

  // mapped
  const [mappedSearch, setMappedSearch] = useState("");
  const [mappedKind, setMappedKind] = useState<KindFilter>("all");
  const [mappedSource, setMappedSource] = useState<SourceFilter>("all");
  const [mappedSort, setMappedSort] = useState<"tracks" | "az">("tracks");

  // resolved
  const [resolvedSearch, setResolvedSearch] = useState("");
  const [resolvedKind, setResolvedKind] = useState<KindFilter>("all");

  // cleanup
  const [cleanupSearch, setCleanupSearch] = useState("");
  const [cleanupKind, setCleanupKind] = useState<KindFilter>("all");

  const nodeById = useMemo(() => new Map(treeNodes.map((n) => [n.id, n])), [treeNodes]);

  useEffect(() => {
    getCanonTree().then((tree) => setTreeNodes(tree.nodes)).catch(console.error);
  }, []);

  useEffect(() => {
    autoMapExact.mutate(undefined, {
      onSuccess: (result) => {
        if (result.mapped > 0 || result.remaining > 0) {
          setAutoMapSummary(result);
        }
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // derived rows
  const reviewRows = unresolvedGenres ?? [];

  const mappedRows = useMemo(
    () => vocab?.filter((r) => r.canonical_id && r.canonical_id !== ACCEPTED && r.canonical_id !== IGNORED && r.track_count > 0) ?? [],
    [vocab]
  );
  const acceptedRows = useMemo(() => vocab?.filter((r) => r.canonical_id === ACCEPTED && r.track_count > 0) ?? [], [vocab]);
  const ignoredRows = useMemo(() => vocab?.filter((r) => r.canonical_id === IGNORED && r.track_count > 0) ?? [], [vocab]);
  const cleanupRows = useMemo(() => vocab?.filter((r) => r.track_count === 0) ?? [], [vocab]);

  // filtered
  const filteredReview = useMemo(() => {
    let rows = applyKindFilter(reviewRows, reviewKind);
    rows = applySearch(rows, reviewSearch);
    if (reviewSort === "az") rows = [...rows].sort((a, b) => a.raw_value.localeCompare(b.raw_value));
    return rows;
  }, [reviewRows, reviewKind, reviewSearch, reviewSort]);

  const filteredMapped = useMemo(() => {
    let rows = applyKindFilter(mappedRows, mappedKind);
    rows = applySearch(rows, mappedSearch);
    if (mappedSource !== "all") rows = rows.filter((r) => r.mapping_source === mappedSource);
    return rows;
  }, [mappedRows, mappedKind, mappedSearch, mappedSource]);

  // Group filtered mapped rows by canonical_id; sort groups by totalTracks or name
  // fallow-ignore-next-line complexity
  const mappedGroups = useMemo((): MappedGroup[] => {
    const byId = new Map<string, VocabRow[]>();
    for (const row of filteredMapped) {
      if (!row.canonical_id) continue;
      const arr = byId.get(row.canonical_id) ?? [];
      arr.push(row);
      byId.set(row.canonical_id, arr);
    }
    const groups: MappedGroup[] = [];
    for (const [canonicalId, rows] of byId) {
      const node = nodeById.get(canonicalId);
      if (!node) continue;
      const variants = [...rows].sort((a, b) => b.track_count - a.track_count);
      const totalTracks = variants.reduce((s, r) => s + r.track_count, 0);
      groups.push({ canonicalId, node, variants, totalTracks });
    }
    // hide trivial identity-only groups (raw_value === canonical name — auto-mapped, no real alias)
    const filtered = groups.filter((g) => !(g.variants.length === 1 && g.variants[0]?.raw_value === g.node.name));
    if (mappedSort === "az") {
      filtered.sort((a, b) => a.node.name.localeCompare(b.node.name));
    } else {
      filtered.sort((a, b) => b.totalTracks - a.totalTracks);
    }
    return filtered;
  }, [filteredMapped, nodeById, mappedSort]);

  const filteredAccepted = useMemo(() => {
    return applySearch(applyKindFilter(acceptedRows, resolvedKind), resolvedSearch);
  }, [acceptedRows, resolvedKind, resolvedSearch]);

  const filteredIgnored = useMemo(() => {
    return applySearch(applyKindFilter(ignoredRows, resolvedKind), resolvedSearch);
  }, [ignoredRows, resolvedKind, resolvedSearch]);

  const filteredCleanup = useMemo(() => {
    return applySearch(applyKindFilter(cleanupRows, cleanupKind), cleanupSearch);
  }, [cleanupRows, cleanupKind, cleanupSearch]);

  // focus mode
  const clampedFocusIdx = Math.min(focusIdx, Math.max(0, filteredReview.length - 1));

  const handleFocusNext = useCallback(() => {
    setFocusIdx((i) => Math.min(i + 1, filteredReview.length - 1));
  }, [filteredReview.length]);

  const handleFocusPrev = useCallback(() => {
    setFocusIdx((i) => Math.max(i - 1, 0));
  }, []);

  // grid pagination
  const totalGridPages = Math.max(1, Math.ceil(filteredReview.length / PAGE_SIZE));
  const currentGridPage = Math.min(gridPage, totalGridPages);
  const pagedReview = gridPages
    ? filteredReview.slice((currentGridPage - 1) * PAGE_SIZE, currentGridPage * PAGE_SIZE)
    : filteredReview;

  // handlers
  function handleMap(rawValue: string, kind: TagKind, canonicalId: string) {
    saveMapping.mutate({ rawValue, kind, canonicalId, source: "manual" });
  }
  function handleAccept(rawValue: string, kind: TagKind) {
    saveMapping.mutate({ rawValue, kind, canonicalId: ACCEPTED });
  }
  function handleIgnore(rawValue: string, kind: TagKind) {
    saveMapping.mutate({ rawValue, kind, canonicalId: IGNORED });
  }

  async function handleDeleteAllCleanup() {
    const unlocked = filteredCleanup.filter((r) => r.locked !== 1);
    for (const row of unlocked) {
      await deleteMapping.mutateAsync({ rawValue: row.raw_value, kind: row.kind });
    }
  }

  // node modal handlers
  function openCreateModal(name: string, rawValue?: string, rawKind?: TagKind) {
    setNodeModalError(undefined);
    setPendingCreate({ name, rawValue, rawKind });
    setEditingNode(null);
  }

  function openEditModal(node: UserTreeNode) {
    setNodeModalError(undefined);
    setEditingNode(node);
    setPendingCreate(null);
  }

  function closeNodeModal() {
    setPendingCreate(null);
    setEditingNode(null);
    setNodeModalError(undefined);
  }

  async function handleNodeSave(state: NodeFormState) {
    setNodeModalError(undefined);
    try {
      if (editingNode) {
        await updateUserNode.mutateAsync({
          id: editingNode.id,
          name: state.name,
          type: state.type,
          parentIds: state.parentId ? [state.parentId] : [],
        });
        // Refresh tree nodes after mutation
        const tree = await getCanonTree();
        setTreeNodes(tree.nodes);
        closeNodeModal();
      } else if (pendingCreate) {
        const newId = await createUserNode.mutateAsync({
          name: state.name,
          type: state.type,
          parentIds: state.parentId ? [state.parentId] : [],
        });
        // Refresh tree nodes, then map raw tag if this came from a combobox
        const tree = await getCanonTree();
        setTreeNodes(tree.nodes);
        if (pendingCreate.rawValue && pendingCreate.rawKind) {
          saveMapping.mutate({ rawValue: pendingCreate.rawValue, kind: pendingCreate.rawKind, canonicalId: newId, source: "manual" });
        }
        closeNodeModal();
      }
    } catch (e) {
      setNodeModalError(e instanceof Error ? e.message : "Failed to save node.");
    }
  }

  async function handleNodeDelete(node: UserTreeNode) {
    setDeletingNode(node);
  }

  async function confirmNodeDelete() {
    if (!deletingNode) return;
    try {
      await deleteUserNode.mutateAsync({ id: deletingNode.id, name: deletingNode.name });
      const tree = await getCanonTree();
      setTreeNodes(tree.nodes);
    } catch (e) {
      console.error(e);
    }
    setDeletingNode(null);
  }

  const supersededCount = userNodes.filter(isSuperseeded).length;

  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: "review", label: "Review", badge: reviewRows.length || undefined },
    { id: "mapped", label: "Mapped" },
    { id: "resolved", label: "Resolved" },
    { id: "cleanup", label: "Cleanup", badge: cleanupRows.length || undefined },
    { id: "tree", label: "Tree", badge: supersededCount || undefined },
  ];

  return (
    <main className="tags-view">
      <header className="tags-header">
        <h1 className="tags-title">Tag Vocabulary</h1>
      </header>

      <div className="tags-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tags-tab-btn${tab === t.id ? " tags-tab-btn--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge ? <span className="tags-tab-badge">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="tags-tab-panel">

        {/* ── Review ───────────────────────────────────────────────────────── */}
        {tab === "review" && (
          <>
            {autoMapSummary && (
              <div className="tags-automap-banner">
                <span className="tags-automap-text">
                  {autoMapSummary.mapped > 0
                    ? `${autoMapSummary.mapped} tag${autoMapSummary.mapped === 1 ? "" : "s"} auto-mapped.`
                    : "No new auto-mappings."}
                  {autoMapSummary.remaining > 0
                    ? ` ${autoMapSummary.remaining} still need${autoMapSummary.remaining === 1 ? "s" : ""} review.`
                    : " All tags resolved."}
                </span>
                <button className="tags-automap-dismiss" onClick={() => setAutoMapSummary(null)}>×</button>
              </div>
            )}
            <div className="tags-review-toolbar">
              <TagFilterBar
                search={reviewSearch}
                onSearch={(s) => { setReviewSearch(s); setFocusIdx(0); setGridPage(1); }}
                kind={reviewKind}
                onKind={(k) => { setReviewKind(k); setFocusIdx(0); setGridPage(1); }}
                sort={reviewSort}
                sortOptions={[{ value: "impact", label: "By impact" }, { value: "az", label: "A–Z" }]}
                onSort={(s) => setReviewSort(s as "impact" | "az")}
              />
              <div className="tags-mode-controls">
                <div className="tags-mode-toggle">
                  <button
                    className={`tags-mode-btn${reviewMode === "focus" ? " tags-mode-btn--active" : ""}`}
                    onClick={() => setReviewMode("focus")}
                    title="Focus mode — one tag at a time"
                  >
                    Focus
                  </button>
                  <button
                    className={`tags-mode-btn${reviewMode === "grid" ? " tags-mode-btn--active" : ""}`}
                    onClick={() => setReviewMode("grid")}
                    title="Grid — browse all"
                  >
                    Grid
                  </button>
                </div>
                {reviewMode === "grid" && (
                  <div className="tags-flow-toggle">
                    <button
                      className={`tags-flow-btn${!gridPages ? " tags-flow-btn--active" : ""}`}
                      onClick={() => setGridPages(false)}
                      title="Show all as continuous flow"
                    >
                      Flow
                    </button>
                    <button
                      className={`tags-flow-btn${gridPages ? " tags-flow-btn--active" : ""}`}
                      onClick={() => { setGridPages(true); setGridPage(1); }}
                      title="Paginate results"
                    >
                      Pages
                    </button>
                  </div>
                )}
              </div>
            </div>

            {filteredReview.length === 0 ? (
              <p className="tags-empty">
                {reviewRows.length === 0 ? "All tags reviewed — genres look good! 🎉" : "No tags match filter."}
              </p>
            ) : reviewMode === "focus" ? (
              <div className="tags-focus-wrap">
                <div className="tags-progress-bar">
                  <div
                    className="tags-progress-fill"
                    style={{
                      width: filteredReview.length <= 1
                        ? "0%"
                        : `${(clampedFocusIdx / (filteredReview.length - 1)) * 100}%`,
                    }}
                  />
                </div>
                <p className="tags-progress-label">
                  {clampedFocusIdx + 1} of {filteredReview.length} remaining
                </p>
                <TagFocusCard
                  key={`${filteredReview[clampedFocusIdx]?.raw_value}:${filteredReview[clampedFocusIdx]?.kind}`}
                  row={filteredReview[clampedFocusIdx]!}
                  index={clampedFocusIdx}
                  total={filteredReview.length}
                  treeNodes={treeNodes}
                  onMap={handleMap}
                  onAccept={handleAccept}
                  onIgnore={handleIgnore}
                  onNext={handleFocusNext}
                  onPrev={handleFocusPrev}
                  onCreateNode={openCreateModal}
                />
              </div>
            ) : (
              <>
                <div className="tags-card-grid">
                  {pagedReview.map((row) => (
                    <TagReviewCard
                      key={`${row.raw_value}:${row.kind}`}
                      row={row}
                      treeNodes={treeNodes}
                      onMap={handleMap}
                      onAccept={handleAccept}
                      onIgnore={handleIgnore}
                      onCreateNode={openCreateModal}
                    />
                  ))}
                </div>
                {gridPages && totalGridPages > 1 && (
                  <div className="tags-pagination">
                    <button
                      className="tags-page-btn"
                      disabled={currentGridPage <= 1}
                      onClick={() => setGridPage((p) => p - 1)}
                    >
                      <div className="tags-page-icon"><ChevronLeft size={14} /></div>
                    </button>
                    <span className="tags-page-info">
                      Page {currentGridPage} of {totalGridPages}
                    </span>
                    <button
                      className="tags-page-btn"
                      disabled={currentGridPage >= totalGridPages}
                      onClick={() => setGridPage((p) => p + 1)}
                    >
                      <div className="tags-page-icon"><ChevronRight size={14} /></div>
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── Mapped ───────────────────────────────────────────────────────── */}
        {tab === "mapped" && (
          <>
            <TagFilterBar
              search={mappedSearch}
              onSearch={setMappedSearch}
              kind={mappedKind}
              onKind={setMappedKind}
              source={mappedSource}
              onSource={setMappedSource}
              sort={mappedSort}
              sortOptions={[{ value: "tracks", label: "By tracks" }, { value: "az", label: "A–Z" }]}
              onSort={(s) => setMappedSort(s as "tracks" | "az")}
            />
            {mappedGroups.length === 0 ? (
              <p className="tags-empty">
                {mappedRows.length === 0 ? "No mapped tags yet." : "No tags match filter."}
              </p>
            ) : (
              <div className="tags-mapped-list">
                {mappedGroups.map((group) => (
                  <TagMappedGroup
                    key={group.canonicalId}
                    group={group}
                    onDelete={(rawValue, kind) => deleteMapping.mutate({ rawValue, kind })}
                    onLock={(rawValue, kind, locked) => lockMapping.mutate({ rawValue, kind, locked })}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Resolved ─────────────────────────────────────────────────────── */}
        {tab === "resolved" && (
          <>
            <TagFilterBar
              search={resolvedSearch}
              onSearch={setResolvedSearch}
              kind={resolvedKind}
              onKind={setResolvedKind}
            />
            <div className="tags-resolved-grid">
              <div className="tags-resolved-col">
                <h3 className="tags-resolved-col-title">
                  Accepted as-is
                  {filteredAccepted.length > 0 && (
                    <span className="tags-resolved-count">{filteredAccepted.length}</span>
                  )}
                </h3>
                <p className="tags-resolved-col-desc">Used in genre output without remapping.</p>
                <ResolvedTagList
                  rows={filteredAccepted}
                  nodeById={nodeById}
                  onUndo={(row) => deleteMapping.mutate({ rawValue: row.raw_value, kind: row.kind })}
                />
              </div>
              <div className="tags-resolved-col">
                <h3 className="tags-resolved-col-title">
                  Ignored
                  {filteredIgnored.length > 0 && (
                    <span className="tags-resolved-count">{filteredIgnored.length}</span>
                  )}
                </h3>
                <p className="tags-resolved-col-desc">Excluded from genre output entirely.</p>
                <ResolvedTagList
                  rows={filteredIgnored}
                  nodeById={nodeById}
                  onUndo={(row) => deleteMapping.mutate({ rawValue: row.raw_value, kind: row.kind })}
                />
              </div>
            </div>
          </>
        )}

        {/* ── Cleanup ──────────────────────────────────────────────────────── */}
        {tab === "cleanup" && (
          <>
            <div className="tags-cleanup-toolbar">
              <TagFilterBar
                search={cleanupSearch}
                onSearch={setCleanupSearch}
                kind={cleanupKind}
                onKind={setCleanupKind}
              />
              {filteredCleanup.filter((r) => r.locked !== 1).length > 0 && (
                <button className="tags-delete-all-btn" onClick={() => { void handleDeleteAllCleanup(); }}>
                  Delete all ({filteredCleanup.filter((r) => r.locked !== 1).length})
                </button>
              )}
            </div>
            <p className="tags-tab-desc">
              Mappings for tags not currently in your library. Still applied during normalization — delete any that are wrong.
            </p>
            {filteredCleanup.length === 0 ? (
              <p className="tags-empty">
                {cleanupRows.length === 0 ? "Nothing to clean up." : "No tags match filter."}
              </p>
            ) : (
              <div className="tags-list">
                {filteredCleanup.map((row) => (
                  <TagListRow
                    key={`${row.raw_value}:${row.kind}`}
                    row={row}
                    nodeById={nodeById}
                    isOrphan
                    showDelete
                    showLock
                    onDelete={() => deleteMapping.mutate({ rawValue: row.raw_value, kind: row.kind })}
                    onLock={() => lockMapping.mutate({ rawValue: row.raw_value, kind: row.kind, locked: row.locked !== 1 })}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Tree ─────────────────────────────────────────────────────────── */}
        {tab === "tree" && (
          <>
            <div className="tree-tab-header">
              <p className="tags-tab-desc">
                Nodes you've added to extend the canon tree. These merge with the bundled taxonomy at runtime.
              </p>
              <button
                className="tree-add-btn"
                onClick={() => openCreateModal("")}
              >
                <Plus size={13} /> Add node
              </button>
            </div>

            {supersededCount > 0 && (
              <div className="tree-conflict-banner">
                <AlertTriangle size={13} />
                {supersededCount} of your node{supersededCount === 1 ? "" : "s"} now {supersededCount === 1 ? "exists" : "exist"} in the bundled tree — review and delete if no longer needed.
              </div>
            )}

            {userNodes.length === 0 ? (
              <p className="tags-empty">No custom nodes yet.</p>
            ) : (
              <div className="tree-node-list">
                {userNodes.map((node) => (
                  <UserNodeRow
                    key={node.id}
                    node={node}
                    treeNodes={treeNodes}
                    onEdit={openEditModal}
                    onDelete={handleNodeDelete}
                  />
                ))}
              </div>
            )}

            {changelog.length > 0 && (
              <div className="tree-changelog">
                <h3 className="tree-changelog-title">Changelog</h3>
                <div className="tree-changelog-list">
                  {changelog.map((entry) => (
                    <div key={entry.id} className="tree-changelog-row">
                      <span className={`tree-changelog-action tree-changelog-action--${entry.action}`}>{entry.action}</span>
                      <span className="tree-changelog-name">{entry.node_name}</span>
                      <span className="tree-changelog-date">{new Date(entry.created_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {(pendingCreate !== null || editingNode !== null) && (
        <NodeModal
          initialName={pendingCreate?.name ?? ""}
          editingNode={editingNode ?? undefined}
          treeNodes={treeNodes}
          onSave={(state) => { void handleNodeSave(state); }}
          onCancel={closeNodeModal}
          error={nodeModalError}
        />
      )}

      {deletingNode && (
        <div className="node-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setDeletingNode(null); }}>
          <div className="node-modal">
            <h3 className="node-modal-title">Delete "{deletingNode.name}"?</h3>
            <p className="node-modal-warn">
              Any tag mappings pointing to this node will be cleared. This cannot be undone.
            </p>
            <div className="node-modal-actions">
              <button className="node-modal-btn node-modal-btn--cancel" onClick={() => setDeletingNode(null)}>Cancel</button>
              <button className="node-modal-btn node-modal-btn--danger" onClick={() => { void confirmNodeDelete(); }}>Delete</button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
