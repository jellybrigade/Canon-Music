import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useTagMappings,
  useAutoMapExact,
  useUnresolvedGenres,
  useUnresolvedAlbums,
} from "../hooks/useTagMappings";
import type { UnresolvedGenreRow } from "../hooks/useTagMappings";
import type { TreeNode, TagKind } from "../lib/canonicalize";
import {
  ACCEPTED,
  IGNORED,
  PAGE_SIZE,
  AlbumArtStrip,
  CanonCombobox,
  TagFilterBar,
  applyKindFilter,
  applySearch,
} from "./TagsViewHelpers";
import type { KindFilter } from "./TagsViewHelpers";

// ── ReviewCard ────────────────────────────────────────────────────────────────

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

// ── FocusCard ─────────────────────────────────────────────────────────────────

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
        <button className="tags-focus-nav-btn" onClick={onPrev} disabled={index === 0}>
          <div className="tags-focus-nav-icon"><ChevronLeft size={13} /></div>
          Prev
        </button>
        <span className="tags-focus-pos">{index + 1} / {total}</span>
        <button className="tags-focus-nav-btn" onClick={onNext} disabled={index >= total - 1}>
          Skip
          <div className="tags-focus-nav-icon"><ChevronRight size={13} /></div>
        </button>
      </div>
    </div>
  );
}

// ── TagReviewTab ──────────────────────────────────────────────────────────────

type ViewMode = "focus" | "grid";

interface TagReviewTabProps {
  treeNodes: TreeNode[];
  onCreateNode: (name: string, rawValue?: string, rawKind?: TagKind) => void;
}

// fallow-ignore-next-line complexity
export function TagReviewTab({ treeNodes, onCreateNode }: TagReviewTabProps) {
  const { data: unresolvedGenres } = useUnresolvedGenres();
  const { saveMapping } = useTagMappings();
  const autoMapExact = useAutoMapExact();

  const [autoMapSummary, setAutoMapSummary] = useState<{ mapped: number; remaining: number } | null>(null);
  const [reviewMode, setReviewMode] = useState<ViewMode>("grid");
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewKind, setReviewKind] = useState<KindFilter>("all");
  const [reviewSort, setReviewSort] = useState<"impact" | "az">("impact");
  const [focusIdx, setFocusIdx] = useState(0);
  const [gridPages, setGridPages] = useState(false);
  const [gridPage, setGridPage] = useState(1);

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

  const reviewRows = unresolvedGenres ?? [];

  const filteredReview = useMemo(() => {
    let rows = applyKindFilter(reviewRows, reviewKind);
    rows = applySearch(rows, reviewSearch);
    if (reviewSort === "az") rows = [...rows].sort((a, b) => a.raw_value.localeCompare(b.raw_value));
    return rows;
  }, [reviewRows, reviewKind, reviewSearch, reviewSort]);

  const clampedFocusIdx = Math.min(focusIdx, Math.max(0, filteredReview.length - 1));

  const handleFocusNext = useCallback(() => {
    setFocusIdx((i) => Math.min(i + 1, filteredReview.length - 1));
  }, [filteredReview.length]);

  const handleFocusPrev = useCallback(() => {
    setFocusIdx((i) => Math.max(i - 1, 0));
  }, []);

  const totalGridPages = Math.max(1, Math.ceil(filteredReview.length / PAGE_SIZE));
  const currentGridPage = Math.min(gridPage, totalGridPages);
  const pagedReview = gridPages
    ? filteredReview.slice((currentGridPage - 1) * PAGE_SIZE, currentGridPage * PAGE_SIZE)
    : filteredReview;

  function handleMap(rawValue: string, kind: TagKind, canonicalId: string) {
    saveMapping.mutate({ rawValue, kind, canonicalId, source: "manual" });
  }
  function handleAccept(rawValue: string, kind: TagKind) {
    saveMapping.mutate({ rawValue, kind, canonicalId: ACCEPTED });
  }
  function handleIgnore(rawValue: string, kind: TagKind) {
    saveMapping.mutate({ rawValue, kind, canonicalId: IGNORED });
  }

  return (
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
            onCreateNode={onCreateNode}
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
                onCreateNode={onCreateNode}
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
  );
}
