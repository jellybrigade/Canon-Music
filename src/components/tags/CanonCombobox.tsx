import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCanonTree, canonicalKey, getParentChain } from "../../lib/canonicalize";
import type { TagKind, TreeNode } from "../../lib/canonicalize";

interface Props {
  value: string;
  kind: TagKind;
  onChange: (value: string, node: TreeNode | null) => void;
  placeholder?: string;
  className?: string;
}

export function CanonCombobox({ value, kind, onChange, placeholder, className }: Props) {
  const [inputValue, setInputValue] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: tree } = useQuery({
    queryKey: ["canon_tree"],
    queryFn: getCanonTree,
    staleTime: Infinity,
  });

  const kindNodes = tree?.nodes.filter((n) => n.type === kind) ?? [];

  const filtered = inputValue.trim().length === 0
    ? []
    : kindNodes
        .filter((n) => {
          const q = canonicalKey(inputValue);
          return n.canonical_key.includes(q) || n.name.toLowerCase().includes(inputValue.toLowerCase());
        })
        .slice(0, 12);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    setHighlighted(0);
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function selectNode(node: TreeNode) {
    setInputValue(node.name);
    setOpen(false);
    onChange(node.name, node);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const node = filtered[highlighted];
      if (node) selectNode(node);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={`canon-combobox${className ? ` ${className}` : ""}`}>
      <input
        ref={inputRef}
        className="canon-combobox-input"
        value={inputValue}
        placeholder={placeholder ?? `Search ${kind}s…`}
        onChange={(e) => {
          setInputValue(e.target.value);
          setOpen(true);
          // Pass raw value immediately; node resolved when selected from list
          onChange(e.target.value, null);
        }}
        onFocus={() => { if (inputValue.trim()) setOpen(true); }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="canon-combobox-dropdown">
          {filtered.map((node, i) => {
            const chain = tree ? getParentChain(node, tree.byId) : [];
            return (
              <li
                key={node.id}
                className={`canon-combobox-option${i === highlighted ? " canon-combobox-option--active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); selectNode(node); }}
                onMouseEnter={() => setHighlighted(i)}
              >
                <span className="canon-combobox-name">{node.name}</span>
                {chain.length > 0 && (
                  <span className="canon-combobox-chain">{chain.join(" › ")}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
