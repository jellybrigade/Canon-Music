import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./ContextMenu.css";

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

interface SubmenuProps {
  label: string;
  children: React.ReactNode;
}

export function ContextMenuSubmenu({ label, children }: SubmenuProps) {
  const [open, setOpen] = useState(false);
  const [flipLeft, setFlipLeft] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  function handleMouseEnter() {
    setOpen(true);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // 180px = submenu min-width; flip left if it would overflow the right edge
      setFlipLeft(rect.right + 180 > window.innerWidth);
    }
  }

  return (
    <div
      className="context-submenu"
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setOpen(false)}
    >
      <button className="context-submenu-trigger">{label} ▸</button>
      {open && (
        <div className={`context-submenu-content${flipLeft ? " context-submenu-content--flip" : ""}`}>
          {children}
        </div>
      )}
    </div>
  );
}

export function ContextMenu({ x, y, onClose, children }: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos({
      top: rect.bottom > vh ? Math.max(0, y - rect.height) : y,
      left: rect.right > vw ? Math.max(0, x - rect.width) : x,
    });
  }, [x, y]);

  useEffect(() => {
    const onClickOutside = () => onCloseRef.current();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("click", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
