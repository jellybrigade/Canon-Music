import { useMemo, useState } from "react";
import { useVocabulary, useTagMappings } from "../hooks/useTagMappings";
import type { TreeNode } from "../lib/canonicalize";
import {
  TagListRow,
  TagFilterBar,
  applyKindFilter,
  applySearch,
} from "./TagsViewHelpers";
import type { KindFilter } from "./TagsViewHelpers";

interface TagCleanupTabProps {
  treeNodes: TreeNode[];
}

export function TagCleanupTab({ treeNodes }: TagCleanupTabProps) {
  const { data: vocab } = useVocabulary();
  const { deleteMapping, lockMapping } = useTagMappings();

  const [cleanupSearch, setCleanupSearch] = useState("");
  const [cleanupKind, setCleanupKind] = useState<KindFilter>("all");

  const nodeById = useMemo(() => new Map(treeNodes.map((n) => [n.id, n])), [treeNodes]);

  const cleanupRows = useMemo(() => vocab?.filter((r) => r.track_count === 0) ?? [], [vocab]);

  const filteredCleanup = useMemo(
    () => applySearch(applyKindFilter(cleanupRows, cleanupKind), cleanupSearch),
    [cleanupRows, cleanupKind, cleanupSearch],
  );

  async function handleDeleteAllCleanup() {
    const unlocked = filteredCleanup.filter((r) => r.locked !== 1);
    for (const row of unlocked) {
      await deleteMapping.mutateAsync({ rawValue: row.raw_value, kind: row.kind });
    }
  }

  return (
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
  );
}
