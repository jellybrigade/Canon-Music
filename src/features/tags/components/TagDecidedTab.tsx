import { useEffect, useMemo, useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { useTagVocab, useTagMappings } from "../hooks/useTagMappings";
import type { TagVocabRow } from "../hooks/useTagMappings";
import type { TagKind, TreeNode } from "../lib/canonicalize";
import { ACCEPTED, IGNORED, applySearch, Pagination } from "./TagsViewHelpers";

// ── MappedGroup ───────────────────────────────────────────────────────────────

interface MappedGroupData {
  canonicalId: string;
  nodeName: string;
  variants: TagVocabRow[];
  albumCount: number;
}

interface MappedGroupProps {
  group: MappedGroupData;
  onUndo: (rawValue: string, kind: TagKind) => void;
  onLock: (rawValue: string, kind: TagKind, locked: boolean) => void;
}

function MappedGroup({ group, onUndo, onLock }: MappedGroupProps) {
  const isLocked = group.variants.every((v) => v.locked === 1);
  const aliasVariants = group.variants.filter(
    (v) => v.raw_value.toLowerCase() !== group.nodeName.toLowerCase(),
  );

  return (
    <div className="decided-group">
      <div className="decided-group-main">
        <span className="decided-group-name">{group.nodeName}</span>
        {group.albumCount > 0 && (
          <span className="decided-group-albums">{group.albumCount}</span>
        )}
        <button
          className="d-undo"
          title="Revert all variants to unresolved"
          onClick={() => { for (const v of group.variants) onUndo(v.raw_value, v.kind); }}
        >
          ↩
        </button>
        <button
          className={`d-lock${isLocked ? " d-lock--active" : ""}`}
          title={isLocked ? "Locked, click to unlock" : "Lock (prevents auto-remap)"}
          onClick={() => { for (const v of group.variants) onLock(v.raw_value, v.kind, !isLocked); }}
        >
          <div>{isLocked ? <Lock size={14} /> : <Unlock size={14} />}</div>
        </button>
      </div>
      {aliasVariants.length > 0 && (
        <div className="decided-aliases">
          {aliasVariants.map((v) => (
            <span key={`${v.raw_value}:${v.kind}`} className="decided-alias-chip">
              <span className="decided-alias-name">{v.raw_value}</span>
              <button
                className="decided-alias-remove"
                title="Unmap this alias"
                onClick={() => onUndo(v.raw_value, v.kind)}
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

// ── SimpleRow (accepted / ignored) ───────────────────────────────────────────

interface SimpleRowProps {
  row: TagVocabRow;
  onUndo: () => void;
}

function SimpleRow({ row, onUndo }: SimpleRowProps) {
  return (
    <div className={`decided-simple-row${row.album_count === 0 ? " decided-row--stale" : ""}`}>
      <span className="d-name">{row.raw_value}</span>
      {row.album_count > 0 && <span className="d-albums">{row.album_count}</span>}
      {row.album_count === 0 && <span className="d-stale">not in library</span>}
      <button className="d-undo" title="Revert to unresolved" onClick={onUndo}>↩</button>
    </div>
  );
}

// ── TagDecidedTab ─────────────────────────────────────────────────────────────

type DecidedFilter = "all" | "mapped" | "accepted" | "ignored";

interface TagDecidedTabProps {
  treeNodes: TreeNode[];
}

// fallow-ignore-next-line complexity
export function TagDecidedTab({ treeNodes }: TagDecidedTabProps) {
  const { data: vocab = [] } = useTagVocab();
  const { deleteMapping, lockMapping } = useTagMappings();

  const [filter, setFilter] = useState<DecidedFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 20;

  const nodeById = useMemo(
    () => new Map(treeNodes.map((n) => [n.id, n])),
    [treeNodes],
  );

  const decidedRows = useMemo(
    () => vocab.filter((r) => !!r.canonical_id),
    [vocab],
  );

  const mappedRows = useMemo(
    () => decidedRows.filter((r) => r.canonical_id !== ACCEPTED && r.canonical_id !== IGNORED),
    [decidedRows],
  );
  const acceptedRows = useMemo(
    () => decidedRows.filter((r) => r.canonical_id === ACCEPTED),
    [decidedRows],
  );
  const ignoredRows = useMemo(
    () => decidedRows.filter((r) => r.canonical_id === IGNORED),
    [decidedRows],
  );

  const counts = {
    all: decidedRows.length,
    mapped: mappedRows.length,
    accepted: acceptedRows.length,
    ignored: ignoredRows.length,
  };

  const mappedGroups = useMemo((): MappedGroupData[] => {
    const rowsToGroup = filter === "accepted" || filter === "ignored" ? [] : applySearch(mappedRows, search);
    const byId = new Map<string, TagVocabRow[]>();
    for (const row of rowsToGroup) {
      if (!row.canonical_id) continue;
      const arr = byId.get(row.canonical_id) ?? [];
      arr.push(row);
      byId.set(row.canonical_id, arr);
    }
    const groups: MappedGroupData[] = [];
    for (const [canonicalId, rows] of byId) {
      const node = nodeById.get(canonicalId);
      const nodeName = node?.name ?? canonicalId;
      const albumCount = rows.reduce((s, r) => s + r.album_count, 0);
      const variants = [...rows].sort((a, b) => b.album_count - a.album_count);
      groups.push({ canonicalId, nodeName, variants, albumCount });
    }
    return groups
      .filter((g) => g.variants.some((v) => v.raw_value.toLowerCase() !== g.nodeName.toLowerCase()))
      .sort((a, b) => b.albumCount - a.albumCount || a.nodeName.localeCompare(b.nodeName));
  }, [mappedRows, nodeById, filter, search]);

  const filteredAccepted = useMemo(
    () => (filter === "mapped" || filter === "ignored") ? [] : applySearch(acceptedRows, search),
    [acceptedRows, filter, search],
  );
  const filteredIgnored = useMemo(
    () => (filter === "mapped" || filter === "accepted") ? [] : applySearch(ignoredRows, search),
    [ignoredRows, filter, search],
  );

  useEffect(() => { setPage(1); }, [search, filter]);

  const pagedGroups = mappedGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagedAccepted = filteredAccepted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagedIgnored = filteredIgnored.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const paginationTotal =
    filter === "accepted" ? filteredAccepted.length
    : filter === "ignored" ? filteredIgnored.length
    : filter === "mapped" ? mappedGroups.length
    : Math.max(mappedGroups.length, filteredAccepted.length, filteredIgnored.length);

  function handleUndo(rawValue: string, kind: TagKind) {
    deleteMapping.mutate({ rawValue, kind });
  }
  function handleLock(rawValue: string, kind: TagKind, locked: boolean) {
    lockMapping.mutate({ rawValue, kind, locked });
  }

  const FILTERS: { id: DecidedFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "mapped", label: "Mapped" },
    { id: "accepted", label: "Accepted" },
    { id: "ignored", label: "Ignored" },
  ];

  const isEmpty = mappedGroups.length === 0 && filteredAccepted.length === 0 && filteredIgnored.length === 0;

  return (
    <>
      <div className="decided-header">
        <input
          className="decided-search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="decided-filter-tabs">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`dtab${filter === f.id ? " dtab--active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className="dtab-count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {isEmpty ? (
        <div className="decided-empty">
          <strong>{decidedRows.length === 0 ? "No decisions yet" : "No items match"}</strong>
          {decidedRows.length === 0
            ? "Map, accept, or ignore tags in the Review tab."
            : "Clear the search or change the filter."}
        </div>
      ) : (
        <>
          <div className="decided-scroll">
            {pagedGroups.length > 0 && (
              <div className="decided-section-block">
                {filter === "all" && filteredAccepted.length + filteredIgnored.length > 0 && (
                  <div className="decided-section-label">Mapped</div>
                )}
                {pagedGroups.map((group) => (
                  <MappedGroup
                    key={group.canonicalId}
                    group={group}
                    onUndo={handleUndo}
                    onLock={handleLock}
                  />
                ))}
              </div>
            )}

            {pagedAccepted.length > 0 && (
              <div className="decided-section-block">
                {filter === "all" && <div className="decided-section-label">Accepted</div>}
                {pagedAccepted.map((row) => (
                  <SimpleRow
                    key={`${row.raw_value}:${row.kind}`}
                    row={row}
                    onUndo={() => handleUndo(row.raw_value, row.kind)}
                  />
                ))}
              </div>
            )}

            {pagedIgnored.length > 0 && (
              <div className="decided-section-block">
                {filter === "all" && <div className="decided-section-label">Ignored</div>}
                {pagedIgnored.map((row) => (
                  <SimpleRow
                    key={`${row.raw_value}:${row.kind}`}
                    row={row}
                    onUndo={() => handleUndo(row.raw_value, row.kind)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="decided-pagination">
            <Pagination page={page} total={paginationTotal} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        </>
      )}
    </>
  );
}
