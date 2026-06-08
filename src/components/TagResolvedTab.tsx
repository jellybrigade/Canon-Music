import { useMemo, useState } from "react";
import { useVocabulary, useTagMappings } from "../hooks/useTagMappings";
import type { TreeNode } from "../lib/canonicalize";
import {
  ACCEPTED,
  IGNORED,
  ResolvedTagList,
  TagFilterBar,
  applyKindFilter,
  applySearch,
} from "./TagsViewHelpers";
import type { KindFilter } from "./TagsViewHelpers";

interface TagResolvedTabProps {
  treeNodes: TreeNode[];
}

export function TagResolvedTab({ treeNodes }: TagResolvedTabProps) {
  const { data: vocab } = useVocabulary();
  const { deleteMapping } = useTagMappings();

  const [resolvedSearch, setResolvedSearch] = useState("");
  const [resolvedKind, setResolvedKind] = useState<KindFilter>("all");

  const nodeById = useMemo(() => new Map(treeNodes.map((n) => [n.id, n])), [treeNodes]);

  const acceptedRows = useMemo(
    () => vocab?.filter((r) => r.canonical_id === ACCEPTED && r.track_count > 0) ?? [],
    [vocab],
  );
  const ignoredRows = useMemo(
    () => vocab?.filter((r) => r.canonical_id === IGNORED && r.track_count > 0) ?? [],
    [vocab],
  );

  const filteredAccepted = useMemo(
    () => applySearch(applyKindFilter(acceptedRows, resolvedKind), resolvedSearch),
    [acceptedRows, resolvedKind, resolvedSearch],
  );
  const filteredIgnored = useMemo(
    () => applySearch(applyKindFilter(ignoredRows, resolvedKind), resolvedSearch),
    [ignoredRows, resolvedKind, resolvedSearch],
  );

  return (
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
  );
}
