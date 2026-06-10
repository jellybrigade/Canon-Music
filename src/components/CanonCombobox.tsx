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

    function initials(s: string) {
      return s.split(/[\s\-_/]+/).map(w => w[0] ?? "").join("").toLowerCase();
    }

    function score(n: { name: string; canonical_key: string }): number {
      const nl = n.name.toLowerCase();
      const kl = n.canonical_key.toLowerCase();
      if (nl === q) return 5;
      if (nl.startsWith(q)) return 4;
      if (nl.includes(q)) return 3;
      if (kl.includes(q)) return 2;
      if (initials(nl) === q) return 2;
      if (initials(nl).startsWith(q) && q.length >= 2) return 1;
      return 0;
    }

    return treeNodes
      .map(n => ({ n, s: score(n) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 10)
      .map(x => x.n);
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
