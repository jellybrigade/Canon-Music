import type { CanonTree } from "./canonicalize";

export interface TagBuckets {
  genres: string[];
  descriptors: string[];
  scenes: string[];
}

export function bucketize(tagIds: string[], tree: CanonTree): TagBuckets {
  const result: TagBuckets = { genres: [], descriptors: [], scenes: [] };
  for (const id of tagIds) {
    const node = tree.byId.get(id);
    if (!node) continue;
    if (node.section === "genres") result.genres.push(id);
    else if (node.section === "descriptors") result.descriptors.push(id);
    else if (node.section === "scenes-and-movements") result.scenes.push(id);
  }
  return result;
}
