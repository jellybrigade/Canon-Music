import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { useClickOutside } from "../hooks/useClickOutside";
import {
  useUserNodes,
  useUserTreeChangelog,
  isSuperseeded,
} from "../hooks/useUserTree";
import type { UserTreeNode } from "../hooks/useUserTree";
import type { TreeNode } from "../lib/canonicalize";
import { canonicalKey } from "../lib/canonicalize";

// ── NodeModal ─────────────────────────────────────────────────────────────────

export type UserNodeType = "genre" | "descriptor" | "scenes-and-movements";

export interface NodeFormState {
  name: string;
  type: UserNodeType;
  parentId: string;
}

interface NodeModalProps {
  initialName?: string;
  editingNode?: UserTreeNode;
  treeNodes: TreeNode[];
  onSave: (state: NodeFormState) => void;
  onCancel: () => void;
  error?: string;
}

export function NodeModal({ initialName = "", editingNode, treeNodes, onSave, onCancel, error }: NodeModalProps) {
  const [name, setName] = useState(editingNode?.name ?? initialName);
  const [type, setType] = useState<UserNodeType>((editingNode?.type as UserNodeType) ?? "genre");
  const [parentId, setParentId] = useState<string>(
    editingNode ? (JSON.parse(editingNode.parent_ids) as string[])[0] ?? "" : "",
  );
  const [parentQuery, setParentQuery] = useState("");
  const [parentOpen, setParentOpen] = useState(false);
  const [parentDropStyle, setParentDropStyle] = useState<React.CSSProperties>({});
  const parentInputRef = useRef<HTMLInputElement>(null);
  const parentWrapRef = useRef<HTMLDivElement>(null);

  const sectionForType = (t: UserNodeType) =>
    t === "genre" ? "genres" : t === "descriptor" ? "descriptors" : "scenes-and-movements";

  const parentMatches = useMemo(() => {
    if (!parentQuery.trim()) return [];
    const q = parentQuery.toLowerCase();
    const section = sectionForType(type);
    return treeNodes
      .filter((n) => n.section === section && (n.name.toLowerCase().includes(q) || n.canonical_key.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [treeNodes, parentQuery, type]);

  const parentNode = treeNodes.find((n) => n.id === parentId) ?? null;

  function openParentDrop() {
    if (parentInputRef.current) {
      const rect = parentInputRef.current.getBoundingClientRect();
      setParentDropStyle({
        position: "fixed",
        top: rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 220),
        zIndex: 10000,
      });
    }
    setParentOpen(true);
  }

  useClickOutside(parentWrapRef, () => { setParentOpen(false); setParentQuery(""); }, parentOpen);

  const previewKey = canonicalKey(name);

  return createPortal(
    <div
      className="node-modal-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="node-modal">
        <h3 className="node-modal-title">{editingNode ? "Edit node" : "Create new node"}</h3>

        <label className="node-modal-label">
          Name
          <input
            className="node-modal-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onSave({ name: name.trim(), type, parentId }); }
              if (e.key === "Escape") onCancel();
            }}
          />
          {name.trim() && <span className="node-modal-key-preview">key: {previewKey}</span>}
        </label>

        <label className="node-modal-label">
          Type
          <div className="tags-seg node-modal-seg">
            {([
              ["genre", "Genre"],
              ["descriptor", "Descriptor"],
              ["scenes-and-movements", "Scenes & Movements"],
            ] as [UserNodeType, string][]).map(([t, label]) => (
              <button
                key={t}
                className={`tags-seg-btn${type === t ? " tags-seg-btn--active" : ""}`}
                onClick={() => { setType(t); setParentId(""); setParentQuery(""); }}
              >
                {label}
              </button>
            ))}
          </div>
        </label>

        <label className="node-modal-label">
          Parent <span className="node-modal-optional">(optional)</span>
          {parentNode ? (
            <div className="tags-mapped" style={{ marginTop: 4 }}>
              <span className="tags-mapped-name">{parentNode.name}</span>
              <button className="tags-clear-btn" onClick={() => { setParentId(""); setParentQuery(""); }}>×</button>
            </div>
          ) : (
            <div className="tags-combobox" ref={parentWrapRef} style={{ marginTop: 4 }}>
              <input
                ref={parentInputRef}
                className="tags-combobox-input"
                placeholder="Search for parent node…"
                value={parentQuery}
                onChange={(e) => { setParentQuery(e.target.value); openParentDrop(); }}
                onFocus={openParentDrop}
              />
              {parentOpen && parentMatches.length > 0 && createPortal(
                <div className="tags-combobox-dropdown" style={parentDropStyle}>
                  {parentMatches.map((n) => (
                    <button
                      key={n.id}
                      className="tags-combobox-option"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setParentId(n.id);
                        setParentQuery("");
                        setParentOpen(false);
                      }}
                    >
                      <span className="tags-option-name">{n.name}</span>
                      <span className="tags-option-section">{n.section ?? n.type}</span>
                    </button>
                  ))}
                </div>,
                document.body,
              )}
            </div>
          )}
        </label>

        {error && <p className="node-modal-error">{error}</p>}

        <div className="node-modal-actions">
          <button className="node-modal-btn node-modal-btn--cancel" onClick={onCancel}>Cancel</button>
          <button
            className="node-modal-btn node-modal-btn--save"
            disabled={!name.trim()}
            onClick={() => onSave({ name: name.trim(), type, parentId })}
          >
            {editingNode ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── UserNodeRow ───────────────────────────────────────────────────────────────

interface TreeNodeRowProps {
  node: UserTreeNode;
  treeNodes: TreeNode[];
  onEdit: (node: UserTreeNode) => void;
  onDelete: (node: UserTreeNode) => void;
}

function UserNodeRow({ node, treeNodes, onEdit, onDelete }: TreeNodeRowProps) {
  const parentIds = JSON.parse(node.parent_ids) as string[];
  const parentName = parentIds[0]
    ? (treeNodes.find((n) => n.id === parentIds[0])?.name ?? parentIds[0])
    : null;
  const superseded = isSuperseeded(node);

  return (
    <div className={`tree-node-row${superseded ? " tree-node-row--superseded" : ""}`}>
      <span className="tree-node-name">{node.name}</span>
      <span className={`tags-kind-badge tags-kind-badge--${node.type}`}>{node.type}</span>
      <div className="tree-node-parent">
        {parentName ? <><span className="tree-node-parent-arrow">↳</span>{parentName}</> : <span style={{ color: "var(--text-tertiary)" }}>-</span>}
        {superseded && (
          <span className="tree-node-conflict" title="A node with this key now exists in the bundled tree">
            <AlertTriangle size={12} /> bundled
          </span>
        )}
      </div>
      <div className="tree-node-row-actions">
        <button className="tree-node-action-btn" onClick={() => onEdit(node)} title="Edit">
          <Pencil size={13} />
        </button>
        <button
          className="tree-node-action-btn tree-node-action-btn--danger"
          onClick={() => onDelete(node)}
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── TagTreeTab ────────────────────────────────────────────────────────────────

interface TagTreeTabProps {
  treeNodes: TreeNode[];
  supersededCount: number;
  onCreateNode: () => void;
  onEditNode: (node: UserTreeNode) => void;
  onDeleteNode: (node: UserTreeNode) => void;
}

export function TagTreeTab({ treeNodes, supersededCount, onCreateNode, onEditNode, onDeleteNode }: TagTreeTabProps) {
  const { data: userNodes = [] } = useUserNodes();
  const { data: changelog = [] } = useUserTreeChangelog();

  return (
    <>
      <div className="tree-tab-header">
        <p className="tags-tab-desc">
          Nodes you've added to extend the canon tree. These merge with the bundled taxonomy at runtime.
        </p>
        <button className="tree-add-btn" onClick={onCreateNode}>
          <Plus size={13} /> Add node
        </button>
      </div>

      {supersededCount > 0 && (
        <div className="tree-conflict-banner">
          <AlertTriangle size={13} />
          {supersededCount} of your node{supersededCount === 1 ? "" : "s"} now{" "}
          {supersededCount === 1 ? "exists" : "exist"} in the bundled tree. Review and delete if no longer needed.
        </div>
      )}

      <div className="tree-scroll">
        {userNodes.length === 0 ? (
          <p className="tags-empty">No custom nodes yet.</p>
        ) : (
          <>
            <div className="tree-col-header">
              <span>Node</span><span>Type</span><span>Parent</span><span></span>
            </div>
            <div className="tree-node-list">
              {userNodes.map((node) => (
                <UserNodeRow
                  key={node.id}
                  node={node}
                  treeNodes={treeNodes}
                  onEdit={onEditNode}
                  onDelete={onDeleteNode}
                />
              ))}
            </div>
          </>
        )}

        {changelog.length > 0 && (
          <div className="tree-changelog">
            <h3 className="tree-changelog-title">Changelog</h3>
            <div className="tree-changelog-list">
              {changelog.map((entry) => (
                <div key={entry.id} className="tree-changelog-row">
                  <span className={`tree-changelog-action tree-changelog-action--${entry.action}`}>
                    {entry.action}
                  </span>
                  <span className="tree-changelog-name">{entry.node_name}</span>
                  <span className="tree-changelog-date">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
