import canonTreeData from "../assets/canon-tree.json";
import type { TreeNode } from "./canonicalize";

export interface TagBuckets {
  genres: string[];
  descriptors: string[];
  scenes: string[];
}

const nodeMap = new Map<string, TreeNode>(
  (canonTreeData.nodes as TreeNode[]).map((n) => [n.id, n])
);

export function bucketize(tagIds: string[]): TagBuckets {
  const result: TagBuckets = { genres: [], descriptors: [], scenes: [] };
  for (const id of tagIds) {
    const node = nodeMap.get(id);
    if (!node) continue;
    if (node.section === "genres") result.genres.push(id);
    else if (node.section === "descriptors") result.descriptors.push(id);
    else if (node.section === "scenes-and-movements") result.scenes.push(id);
  }
  return result;
}
