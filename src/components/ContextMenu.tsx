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
  const [flipUp, setFlipUp] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  function handleMouseEnter() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setFlipLeft(rect.right + 180 > window.innerWidth);
      // 220px covers 8-item radio submenus; avoids two-phase render flash
      setFlipUp(rect.bottom + 220 > window.innerHeight);
    }
    setOpen(true);
  }

  const cls = [
    "context-submenu-content",
    flipLeft ? "context-submenu-content--flip" : "",
    flipUp ? "context-submenu-content--flip-up" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className="context-submenu"
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setOpen(false)}
    >
      <button className="context-submenu-trigger">{label} ▸</button>
      {open && (
        <div className={cls}>
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
    // mousedown + containment check (not click + stopPropagation): closing only
    // when the pointer-down target is outside the menu means item selection is
    // unaffected regardless of mousedown/click dispatch order or event-timing
    // quirks (WebKitGTK in particular can deliver a stray click before this
    // listener attaches).
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    // The menu is positioned once at open time (fixed x/y) and never re-anchored,
    // so if the page underneath scrolls, close instead of leaving it floating
    // detached from whatever opened it.
    const onScroll = () => onCloseRef.current();
    // Defer attaching: the same mousedown that opened this menu is still
    // propagating to document when this effect runs, which would close the
    // menu immediately.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", onPointerDown, { capture: true });
      document.addEventListener("keydown", onKey);
      document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onPointerDown, { capture: true });
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, { capture: true });
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
