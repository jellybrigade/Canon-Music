import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { useClickOutside } from "../hooks/useClickOutside";
import type { TreeNode } from "../lib/canonicalize";

export interface ComboboxProps {
  treeNodes: TreeNode[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  onCreateNode?: (name: string) => void;
}

export function CanonCombobox({ treeNodes, currentId, onSelect, onClear, onCreateNode }: ComboboxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const currentName = useMemo(
    () => treeNodes.find((n) => n.id === currentId)?.name ?? null,
    [treeNodes, currentId]
  );

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return treeNodes
      .filter((n) => n.name.toLowerCase().includes(q) || n.canonical_key.toLowerCase().includes(q))
      .slice(0, 10);
  }, [treeNodes, query]);

  const canCreate =
    onCreateNode &&
    query.trim().length > 0 &&
    !treeNodes.some((n) => n.name.toLowerCase() === query.trim().toLowerCase());

  function openDropdown() {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: "fixed",
        top: rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 220),
        zIndex: 9999,
      });
    }
    setOpen(true);
  }

  useClickOutside(wrapRef, () => { setOpen(false); setQuery(""); }, open);

  if (currentId && currentName) {
    return (
      <div className="tags-mapped">
        <span className="tags-mapped-name">{currentName}</span>
        <button className="tags-clear-btn" onClick={onClear} title="Remove mapping">×</button>
      </div>
    );
  }

  const showDropdown = open && (matches.length > 0 || canCreate);

  return (
    <div className="tags-combobox" ref={wrapRef}>
      <input
        ref={inputRef}
        className="tags-combobox-input"
        placeholder="Search canon tree…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); openDropdown(); }}
        onFocus={openDropdown}
      />
      {showDropdown && createPortal(
        <div className="tags-combobox-dropdown" style={dropdownStyle}>
          {matches.map((n) => (
            <button
              key={n.id}
              className="tags-combobox-option"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(n.id);
                setQuery("");
                setOpen(false);
              }}
            >
              <span className="tags-option-name">{n.name}</span>
              <span className="tags-option-section">{n.section ?? n.type}</span>
            </button>
          ))}
          {canCreate && (
            <button
              className="tags-combobox-option tags-combobox-create"
              onMouseDown={(e) => {
                e.preventDefault();
                onCreateNode!(query.trim());
                setQuery("");
                setOpen(false);
              }}
            >
              <Plus size={12} />
              <span className="tags-option-name">Create "{query.trim()}"</span>
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
