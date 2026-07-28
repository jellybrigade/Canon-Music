import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { canonicalKey, bustCanonTreeCache } from "../lib/canonicalize";
import canonTreeData from "../assets/canon-tree.json";
import type { TreeNode } from "../lib/canonicalize";
import { QK } from "../lib/query-keys";
import { invalidateManualMappings } from "../lib/manual-mappings";

export interface UserTreeNode {
  id: string;
  name: string;
  type: "genre" | "descriptor" | "scenes-and-movements";
  canonical_key: string;
  parent_ids: string; // JSON-encoded string[]
}

export interface ChangelogEntry {
  id: number;
  node_id: string;
  node_name: string;
  action: "create" | "update" | "delete";
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

const BUNDLED_KEYS = new Set((canonTreeData.nodes as TreeNode[]).map((n) => canonicalKey(n.name)));

export function isSuperseeded(node: UserTreeNode): boolean {
  return BUNDLED_KEYS.has(node.canonical_key);
}

function nodeToJson(node: Omit<UserTreeNode, "parent_ids"> & { parentIds: string[] }): string {
  return JSON.stringify({ name: node.name, type: node.type, canonical_key: node.canonical_key, parent_ids: node.parentIds });
}

export function useUserNodes() {
  return useQuery({
    queryKey: QK.userTreeNodes(),
    queryFn: async (): Promise<UserTreeNode[]> => {
      const db = await getDb();
      return db.select<UserTreeNode[]>("SELECT * FROM user_tree_nodes ORDER BY name");
    },
  });
}

export function useUserTreeChangelog() {
  return useQuery({
    queryKey: QK.userTreeChangelog(),
    queryFn: async (): Promise<ChangelogEntry[]> => {
      const db = await getDb();
      return db.select<ChangelogEntry[]>(
        "SELECT * FROM user_tree_changelog ORDER BY created_at DESC LIMIT 100"
      );
    },
  });
}

export function useCreateUserNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      type,
      parentIds = [],
    }: {
      name: string;
      type: "genre" | "descriptor" | "scenes-and-movements";
      parentIds?: string[];
    }): Promise<string> => {
      const db = await getDb();
      const key = canonicalKey(name);
      const id = `user:${key}`;
      const parentJson = JSON.stringify(parentIds);

      const existing = await db.select<{ id: string }[]>(
        "SELECT id FROM user_tree_nodes WHERE id = ?",
        [id]
      );
      if (existing.length > 0) throw new Error(`Node "${name}" already exists.`);

      await db.execute(
        "INSERT INTO user_tree_nodes (id, name, type, canonical_key, parent_ids) VALUES (?, ?, ?, ?, ?)",
        [id, name, type, key, parentJson]
      );
      await db.execute(
        `INSERT INTO user_tree_changelog (node_id, node_name, action, before_json, after_json)
         VALUES (?, ?, 'create', NULL, ?)`,
        [id, name, nodeToJson({ id, name, type, canonical_key: key, parentIds })]
      );

      bustCanonTreeCache();
      return id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.userTreeNodes() });
      void queryClient.invalidateQueries({ queryKey: QK.userTreeChangelog() });
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
    },
  });
}

export function useUpdateUserNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      name,
      type,
      parentIds,
    }: {
      id: string;
      name: string;
      type: "genre" | "descriptor" | "scenes-and-movements";
      parentIds: string[];
    }) => {
      const db = await getDb();
      const key = canonicalKey(name);
      const parentJson = JSON.stringify(parentIds);

      const existing = await db.select<UserTreeNode[]>(
        "SELECT * FROM user_tree_nodes WHERE id = ?",
        [id]
      );
      if (!existing[0]) throw new Error("Node not found.");

      await db.execute(
        `INSERT INTO user_tree_changelog (node_id, node_name, action, before_json, after_json)
         VALUES (?, ?, 'update', ?, ?)`,
        [
          id,
          name,
          JSON.stringify(existing[0]),
          nodeToJson({ id, name, type, canonical_key: key, parentIds }),
        ]
      );
      await db.execute(
        "UPDATE user_tree_nodes SET name = ?, type = ?, canonical_key = ?, parent_ids = ? WHERE id = ?",
        [name, type, key, parentJson, id]
      );

      bustCanonTreeCache();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.userTreeNodes() });
      void queryClient.invalidateQueries({ queryKey: QK.userTreeChangelog() });
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
    },
  });
}

export function useDeleteUserNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const db = await getDb();
      const existing = await db.select<UserTreeNode[]>(
        "SELECT * FROM user_tree_nodes WHERE id = ?",
        [id]
      );
      if (!existing[0]) throw new Error("Node not found.");

      await db.execute(
        `INSERT INTO user_tree_changelog (node_id, node_name, action, before_json, after_json)
         VALUES (?, ?, 'delete', ?, NULL)`,
        [id, name, JSON.stringify(existing[0])]
      );
      // Clear any tag_mappings pointing to this node
      await db.execute("DELETE FROM tag_mappings WHERE canonical_id = ?", [id]);
      invalidateManualMappings();
      await db.execute("UPDATE track_tags SET canonical_id = NULL WHERE canonical_id = ?", [id]);
      await db.execute("DELETE FROM user_tree_nodes WHERE id = ?", [id]);

      bustCanonTreeCache();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.userTreeNodes() });
      void queryClient.invalidateQueries({ queryKey: QK.userTreeChangelog() });
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
    },
  });
}
