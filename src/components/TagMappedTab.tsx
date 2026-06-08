import { useMemo, useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { useVocabulary, useTagMappings, useVocabAlbums } from "../hooks/useTagMappings";
import type { VocabRow } from "../hooks/useTagMappings";
import type { TreeNode } from "../lib/canonicalize";
import {
  ACCEPTED,
  IGNORED,
  AlbumArtStrip,
  TagFilterBar,
  applyKindFilter,
  applySearch,
} from "./TagsViewHelpers";
import type { ArtAlbum, KindFilter, SourceFilter, MappedGroup } from "./TagsViewHelpers";

// ── TagMappedGroup ────────────────────────────────────────────────────────────

interface MappedGroupProps {
  group: MappedGroup;
  onDelete: (rawValue: string, kind: VocabRow["kind"]) => void;
  onLock: (rawValue: string, kind: VocabRow["kind"], locked: boolean) => void;
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

// ── TagMappedTab ──────────────────────────────────────────────────────────────

interface TagMappedTabProps {
  treeNodes: TreeNode[];
}

// fallow-ignore-next-line complexity
export function TagMappedTab({ treeNodes }: TagMappedTabProps) {
  const { data: vocab } = useVocabulary();
  const { deleteMapping, lockMapping } = useTagMappings();

  const [mappedSearch, setMappedSearch] = useState("");
  const [mappedKind, setMappedKind] = useState<KindFilter>("all");
  const [mappedSource, setMappedSource] = useState<SourceFilter>("all");
  const [mappedSort, setMappedSort] = useState<"tracks" | "az">("tracks");

  const nodeById = useMemo(() => new Map(treeNodes.map((n) => [n.id, n])), [treeNodes]);

  const mappedRows = useMemo(
    () =>
      vocab?.filter(
        (r) => r.canonical_id && r.canonical_id !== ACCEPTED && r.canonical_id !== IGNORED && r.track_count > 0,
      ) ?? [],
    [vocab],
  );

  const filteredMapped = useMemo(() => {
    let rows = applyKindFilter(mappedRows, mappedKind);
    rows = applySearch(rows, mappedSearch);
    if (mappedSource !== "all") rows = rows.filter((r) => r.mapping_source === mappedSource);
    return rows;
  }, [mappedRows, mappedKind, mappedSearch, mappedSource]);

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
    const filtered = groups.filter(
      (g) => !(g.variants.length === 1 && g.variants[0]?.raw_value === g.node.name),
    );
    if (mappedSort === "az") {
      filtered.sort((a, b) => a.node.name.localeCompare(b.node.name));
    } else {
      filtered.sort((a, b) => b.totalTracks - a.totalTracks);
    }
    return filtered;
  }, [filteredMapped, nodeById, mappedSort]);

  return (
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
  );
}
