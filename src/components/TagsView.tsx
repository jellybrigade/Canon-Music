import { useEffect, useState } from "react";
import { useVocabulary, useUnresolvedGenres, useTagMappings } from "../hooks/useTagMappings";
import {
  useUserNodes,
  useCreateUserNode,
  useUpdateUserNode,
  useDeleteUserNode,
  isSuperseeded,
} from "../hooks/useUserTree";
import type { UserTreeNode } from "../hooks/useUserTree";
import type { TagKind, TreeNode } from "../lib/canonicalize";
import { getCanonTree } from "../lib/canonicalize";
import { NodeModal } from "./TagTreeTab";
import type { NodeFormState } from "./TagTreeTab";
import { TagReviewTab } from "./TagReviewTab";
import { TagMappedTab } from "./TagMappedTab";
import { TagResolvedTab } from "./TagResolvedTab";
import { TagCleanupTab } from "./TagCleanupTab";
import { TagTreeTab } from "./TagTreeTab";
import "./TagsView.css";

type TabId = "review" | "mapped" | "resolved" | "cleanup" | "tree";

interface PendingCreate {
  name: string;
  rawValue?: string;
  rawKind?: TagKind;
}

// fallow-ignore-next-line complexity
export function TagsView() {
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [tab, setTab] = useState<TabId>("review");

  // modal state
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [editingNode, setEditingNode] = useState<UserTreeNode | null>(null);
  const [nodeModalError, setNodeModalError] = useState<string | undefined>();
  const [deletingNode, setDeletingNode] = useState<UserTreeNode | null>(null);

  const { data: unresolvedGenres } = useUnresolvedGenres();
  const { data: vocab } = useVocabulary();
  const { data: userNodes = [] } = useUserNodes();
  const { saveMapping } = useTagMappings();
  const createUserNode = useCreateUserNode();
  const updateUserNode = useUpdateUserNode();
  const deleteUserNode = useDeleteUserNode();

  useEffect(() => {
    getCanonTree().then((tree) => setTreeNodes(tree.nodes)).catch(console.error);
  }, []);

  async function refreshTree() {
    const tree = await getCanonTree();
    setTreeNodes(tree.nodes);
  }

  // tab badges
  const reviewBadge = unresolvedGenres?.length || undefined;
  const cleanupBadge = vocab?.filter((r) => r.track_count === 0).length || undefined;
  const supersededCount = userNodes.filter(isSuperseeded).length;

  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: "review", label: "Review", badge: reviewBadge },
    { id: "mapped", label: "Mapped" },
    { id: "resolved", label: "Resolved" },
    { id: "cleanup", label: "Cleanup", badge: cleanupBadge },
    { id: "tree", label: "Tree", badge: supersededCount || undefined },
  ];

  // modal handlers
  function openCreateModal(name: string, rawValue?: string, rawKind?: TagKind) {
    setNodeModalError(undefined);
    setPendingCreate({ name, rawValue, rawKind });
    setEditingNode(null);
  }

  function openEditModal(node: UserTreeNode) {
    setNodeModalError(undefined);
    setEditingNode(node);
    setPendingCreate(null);
  }

  function closeNodeModal() {
    setPendingCreate(null);
    setEditingNode(null);
    setNodeModalError(undefined);
  }

  async function handleNodeSave(state: NodeFormState) {
    setNodeModalError(undefined);
    try {
      if (editingNode) {
        await updateUserNode.mutateAsync({
          id: editingNode.id,
          name: state.name,
          type: state.type,
          parentIds: state.parentId ? [state.parentId] : [],
        });
        await refreshTree();
        closeNodeModal();
      } else if (pendingCreate) {
        const newId = await createUserNode.mutateAsync({
          name: state.name,
          type: state.type,
          parentIds: state.parentId ? [state.parentId] : [],
        });
        await refreshTree();
        if (pendingCreate.rawValue && pendingCreate.rawKind) {
          saveMapping.mutate({
            rawValue: pendingCreate.rawValue,
            kind: pendingCreate.rawKind,
            canonicalId: newId,
            source: "manual",
          });
        }
        closeNodeModal();
      }
    } catch (e) {
      setNodeModalError(e instanceof Error ? e.message : "Failed to save node.");
    }
  }

  async function confirmNodeDelete() {
    if (!deletingNode) return;
    try {
      await deleteUserNode.mutateAsync({ id: deletingNode.id, name: deletingNode.name });
      await refreshTree();
    } catch (e) {
      console.error(e);
    }
    setDeletingNode(null);
  }

  return (
    <main className="tags-view">
      <header className="tags-header">
        <h1 className="tags-title">Tag Vocabulary</h1>
      </header>

      <div className="tags-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tags-tab-btn${tab === t.id ? " tags-tab-btn--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge ? <span className="tags-tab-badge">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="tags-tab-panel">
        {tab === "review" && (
          <TagReviewTab treeNodes={treeNodes} onCreateNode={openCreateModal} />
        )}
        {tab === "mapped" && (
          <TagMappedTab treeNodes={treeNodes} />
        )}
        {tab === "resolved" && (
          <TagResolvedTab treeNodes={treeNodes} />
        )}
        {tab === "cleanup" && (
          <TagCleanupTab treeNodes={treeNodes} />
        )}
        {tab === "tree" && (
          <TagTreeTab
            treeNodes={treeNodes}
            supersededCount={supersededCount}
            onCreateNode={() => openCreateModal("")}
            onEditNode={openEditModal}
            onDeleteNode={setDeletingNode}
          />
        )}
      </div>

      {(pendingCreate !== null || editingNode !== null) && (
        <NodeModal
          initialName={pendingCreate?.name ?? ""}
          editingNode={editingNode ?? undefined}
          treeNodes={treeNodes}
          onSave={(state) => { void handleNodeSave(state); }}
          onCancel={closeNodeModal}
          error={nodeModalError}
        />
      )}

      {deletingNode && (
        <div
          className="node-modal-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setDeletingNode(null); }}
        >
          <div className="node-modal">
            <h3 className="node-modal-title">Delete "{deletingNode.name}"?</h3>
            <p className="node-modal-warn">
              Any tag mappings pointing to this node will be cleared. This cannot be undone.
            </p>
            <div className="node-modal-actions">
              <button className="node-modal-btn node-modal-btn--cancel" onClick={() => setDeletingNode(null)}>
                Cancel
              </button>
              <button className="node-modal-btn node-modal-btn--danger" onClick={() => { void confirmNodeDelete(); }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
