import { useEffect, useRef, useState } from "react";
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
  return (
    <div
      className="context-submenu"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button className="context-submenu-trigger">{label} ▸</button>
      {open && (
        <div className="context-submenu-content">
          {children}
        </div>
      )}
    </div>
  );
}

export function ContextMenu({ x, y, onClose, children }: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
      className="context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
