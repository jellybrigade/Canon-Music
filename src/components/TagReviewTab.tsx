import { useEffect, useRef, useMemo, useState } from "react";
import { useTagMappings, useTagVocab } from "../hooks/useTagMappings";
import type { TagVocabRow } from "../hooks/useTagMappings";
import type { TreeNode, TagKind } from "../lib/canonicalize";
import {
  ACCEPTED,
  IGNORED,
  AlbumArtStrip,
  TagSourceDots,
  SOURCE_META,
  CanonCombobox,
  applySearch,
  Pagination,
} from "./TagsViewHelpers";

// ── ReviewRow ─────────────────────────────────────────────────────────────────

interface ReviewRowProps {
  row: TagVocabRow;
  treeNodes: TreeNode[];
  onMap: (rawValue: string, kind: TagKind, canonicalId: string) => void;
  onAccept: (rawValue: string, kind: TagKind) => void;
  onIgnore: (rawValue: string, kind: TagKind) => void;
  onCreateNode: (name: string, rawValue: string, rawKind: TagKind) => void;
}

function ReviewRow({ row, treeNodes, onMap, onAccept, onIgnore, onCreateNode }: ReviewRowProps) {
  return (
    <div className="review-row">
      <div className="rr-info">
        <TagSourceDots sources={row.sources} />
        <span className="rr-name">{row.raw_value}</span>
        <AlbumArtStrip rawValue={row.raw_value} kind={row.kind} size={30} max={6} />
        <span className="rr-albums">{row.album_count}</span>
      </div>
      <div className="rr-actions">
        <CanonCombobox
          treeNodes={treeNodes}
          currentId={null}
          onSelect={(id) => onMap(row.raw_value, row.kind, id)}
          onClear={() => {}}
          onCreateNode={(name) => onCreateNode(name, row.raw_value, row.kind)}
        />
        <button
          className="btn-flat accept"
          onClick={() => onAccept(row.raw_value, row.kind)}
          title="Accept this tag as-is, keep in genre output without remapping"
        >
          Accept
        </button>
        <button
          className="btn-flat ignore"
          onClick={() => onIgnore(row.raw_value, row.kind)}
          title="Ignore, exclude from genre output"
        >
          Ignore
        </button>
      </div>
    </div>
  );
}

// ── TagReviewTab ──────────────────────────────────────────────────────────────

interface TagReviewTabProps {
  treeNodes: TreeNode[];
  autoNote: string | null;
  onDismissAutoNote: () => void;
  onCreateNode: (name: string, rawValue?: string, rawKind?: TagKind) => void;
}

// Must match `.review-row { min-height }` in TagsView.css
const ROW_HEIGHT = 56;
const DEFAULT_PAGE_SIZE = 12;

export function TagReviewTab({ treeNodes, autoNote, onDismissAutoNote, onCreateNode }: TagReviewTabProps) {
  const { data: vocab = [], isLoading, isError, error } = useTagVocab();
  const { saveMapping } = useTagMappings();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [containerHeight, setContainerHeight] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      if (h > 0) setContainerHeight(h);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pageSize = containerHeight !== null
    ? Math.max(1, Math.floor(containerHeight / ROW_HEIGHT))
    : DEFAULT_PAGE_SIZE;

  const unresolvedRows = useMemo(
    () => vocab.filter((r) => !r.canonical_id && r.album_count > 0),
    [vocab],
  );

  const filteredRows = useMemo(() => applySearch(unresolvedRows, search), [unresolvedRows, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));

  useEffect(() => { setPage(1); }, [search]);

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [pageSize, totalPages]);

  function handleMap(rawValue: string, k: TagKind, canonicalId: string) {
    saveMapping.mutate({ rawValue, kind: k, canonicalId, source: "manual" });
  }
  function handleAccept(rawValue: string, k: TagKind) {
    saveMapping.mutate({ rawValue, kind: k, canonicalId: ACCEPTED });
  }
  function handleIgnore(rawValue: string, k: TagKind) {
    saveMapping.mutate({ rawValue, kind: k, canonicalId: IGNORED });
  }

  if (isLoading) {
    return <div className="review-empty"><strong>Loading…</strong></div>;
  }

  if (isError) {
    return (
      <div className="review-empty">
        <strong>Failed to load tags</strong>
        {String(error)}
      </div>
    );
  }

  return (
    <>
      {autoNote && (
        <div className="review-autonote">
          {autoNote}
          <button className="review-autonote-dismiss" onClick={onDismissAutoNote}>×</button>
        </div>
      )}
      <div className="review-toolbar">
        <input
          className="review-search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="review-toolbar-pagination">
          <Pagination page={page} total={filteredRows.length} pageSize={pageSize} onChange={setPage} />
        </div>
        <div className="review-legend">
          {Object.entries(SOURCE_META).map(([, { cls, label }]) => (
            <span key={cls} className="review-legend-item">
              <span className={`tag-src-dot ${cls}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="review-empty">
          <strong>{unresolvedRows.length === 0 ? "All tags resolved" : "No tags match"}</strong>
          {unresolvedRows.length === 0
            ? `${vocab.length} tag${vocab.length === 1 ? "" : "s"} total, all mapped, accepted, or ignored.`
            : "Clear the search filter to see all pending tags."}
        </div>
      ) : (
        <div className="review-fit" ref={containerRef}>
          {filteredRows.slice((page - 1) * pageSize, page * pageSize).map((row) => (
            <ReviewRow
              key={`${row.raw_value}:${row.kind}`}
              row={row}
              treeNodes={treeNodes}
              onMap={handleMap}
              onAccept={handleAccept}
              onIgnore={handleIgnore}
              onCreateNode={onCreateNode}
            />
          ))}
        </div>
      )}
    </>
  );
}
