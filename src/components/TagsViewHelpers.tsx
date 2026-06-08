import { useServers, useServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl } from "../lib/navidrome";
import { Lock, Unlock } from "lucide-react";
import { CanonCombobox } from "./CanonCombobox";
import type { TreeNode, TagKind } from "../lib/canonicalize";
import type { VocabRow } from "../hooks/useTagMappings";
import { useVocabAlbums } from "../hooks/useTagMappings";

export const ACCEPTED = "__accepted__";
export const IGNORED = "__ignored__";
export const PAGE_SIZE = 24;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ArtAlbum = { album_id: string; album_name: string; artwork_url: string | null };
export type KindFilter = "all" | "genre" | "mood";
export type SourceFilter = "all" | "auto" | "manual";
export interface SegOption { value: string; label: string }

export interface MappedGroup {
  canonicalId: string;
  node: TreeNode;
  variants: VocabRow[];
  totalTracks: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const KIND_OPTIONS: SegOption[] = [
  { value: "all", label: "All" },
  { value: "genre", label: "Genre" },
  { value: "mood", label: "Mood" },
];

export const SOURCE_OPTIONS: SegOption[] = [
  { value: "all", label: "All" },
  { value: "auto", label: "Auto" },
  { value: "manual", label: "Manual" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function applyKindFilter<T extends { kind: TagKind }>(rows: T[], kind: KindFilter): T[] {
  return kind === "all" ? rows : rows.filter((r) => r.kind === kind);
}

export function applySearch<T extends { raw_value: string }>(rows: T[], search: string): T[] {
  if (!search.trim()) return rows;
  const q = search.toLowerCase();
  return rows.filter((r) => r.raw_value.toLowerCase().includes(q));
}

// ── AlbumArtStrip ─────────────────────────────────────────────────────────────

export function AlbumArtStrip({ albums, size = 40 }: { albums: ArtAlbum[]; size?: number }) {
  const { data: servers } = useServers();
  const { data: swc } = useServerWithCredential(servers?.[0]?.id);

  const tiles = albums
    .map((a) => ({
      ...a,
      url:
        swc && a.artwork_url
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

// ── SourceBadge ───────────────────────────────────────────────────────────────

export function SourceBadge({ source }: { source: "auto" | "manual" | null }) {
  if (!source) return null;
  return (
    <span className={`tags-source-badge tags-source-badge--${source}`}>
      {source === "auto" ? "AUTO" : "MANUAL"}
    </span>
  );
}

// ── SegToggle ─────────────────────────────────────────────────────────────────

export function SegToggle({ value, options, onChange }: {
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

// ── TagFilterBar ──────────────────────────────────────────────────────────────

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

export function TagFilterBar({ search, onSearch, kind, onKind, source, onSource, sort, sortOptions, onSort }: FilterBarProps) {
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

// ── TagListRow ────────────────────────────────────────────────────────────────

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
export function TagListRow({ row, nodeById, showUndo, showDelete, showLock, isOrphan, onUndo, onDelete, onLock }: ListRowProps) {
  const { data: albums = [] } = useVocabAlbums(row.raw_value, row.kind);
  const isLocked = row.locked === 1;
  const mappedNode =
    row.canonical_id && row.canonical_id !== ACCEPTED && row.canonical_id !== IGNORED
      ? nodeById.get(row.canonical_id)
      : null;
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

// ── ResolvedTagList ───────────────────────────────────────────────────────────

interface ResolvedTagListProps {
  rows: VocabRow[];
  nodeById: Map<string, TreeNode>;
  onUndo: (row: VocabRow) => void;
}

export function ResolvedTagList({ rows, nodeById, onUndo }: ResolvedTagListProps) {
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

// Re-export CanonCombobox so tabs only need one import for tag-related components
export { CanonCombobox };
