import { useDanglingGenreIds, useRepairDanglingGenreId } from "../hooks/useDanglingGenreIds";
import type { DanglingGenreId } from "../lib/danglingGenreIds";
import type { TreeNode } from "../lib/canonicalize";
import { CanonCombobox } from "./CanonCombobox";

const USE_LABELS: Record<string, [string, string]> = {
  tag_mappings: ["tag mapping", "tag mappings"],
  track_tags: ["track tag", "track tags"],
  album_genres: ["album genre", "album genres"],
  album_user_genres: ["genre you added", "genres you added"],
  album_genre_exclusions: ["genre you removed", "genres you removed"],
  user_tree_nodes: ["custom genre parent", "custom genre parents"],
  playlists: ["smart playlist", "smart playlists"],
};

function describeUses(uses: DanglingGenreId["uses"]): string {
  return uses
    .map(({ table, count }) => {
      const [one, many] = USE_LABELS[table] ?? [table, table];
      return `${count} ${count === 1 ? one : many}`;
    })
    .join(", ");
}

export function DanglingGenresPanel({ treeNodes }: { treeNodes: TreeNode[] }) {
  const { data: dangling, isError } = useDanglingGenreIds();
  const repair = useRepairDanglingGenreId();

  if (isError) {
    return (
      <div className="review-dangling review-dangling-note" role="alert">
        Couldn't check for genres missing from the tree.
      </div>
    );
  }
  if (!dangling || dangling.length === 0) return null;

  function remap(from: string, toId: string) {
    const node = treeNodes.find((candidate) => candidate.id === toId);
    if (!node) return;
    repair.mutate({ from, to: { id: node.id, name: node.name } });
  }

  return (
    <section className="review-dangling" aria-label="Genres missing from the tree">
      <p className="review-dangling-note">
        {dangling.length === 1 ? "1 genre is" : `${dangling.length} genres are`} still used but no longer in
        the genre tree. Map each to a genre, or remove it everywhere.
      </p>
      {repair.isError && (
        <p className="review-dangling-note review-dangling-error" role="alert">
          {repair.error instanceof Error ? repair.error.message : String(repair.error)}
        </p>
      )}
      <div className="review-dangling-list">
        {dangling.map((entry) => (
          <div key={entry.id} className="review-dangling-row">
            <div className="rd-info">
              <span className="rd-name">{entry.name ?? entry.id}</span>
              <span className="rd-uses">{describeUses(entry.uses)}</span>
            </div>
            <div className="rr-actions">
              <CanonCombobox
                treeNodes={treeNodes}
                currentId={null}
                onSelect={(id) => remap(entry.id, id)}
                onClear={() => {}}
              />
              <button
                className="btn-flat ignore"
                disabled={repair.isPending}
                onClick={() => repair.mutate({ from: entry.id, to: null })}
                title="Remove this genre from every album, mapping and playlist that uses it"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
