// @vitest-environment jsdom
//
// Unit-level cover for the shared modal chrome. The composition question - does a modal opened
// inside the search overlay stop the overlay from eating Escape - is answered at the acceptance
// level in `src/app/App.modalInOverlay.test.tsx`; this file pins the hook's own contract, which
// that test can only observe through one modal at a time.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import { useModalChrome, useAnyModalOpen, __resetModalRegistry } from "./useModalChrome";

/** A minimal modal: two focusables, plus whatever the case needs. */
function Modal({
  onClose,
  closable,
  label = "dialog",
  children,
}: {
  onClose: () => void;
  closable?: boolean;
  label?: string;
  children?: React.ReactNode;
}) {
  const chrome = useModalChrome(onClose, { closable });
  return (
    <div {...chrome} aria-label={label}>
      {children ?? (
        <>
          <button>first</button>
          <button>last</button>
        </>
      )}
    </div>
  );
}

/** Reports the registry the way `App.tsx` reads it. */
function RegistryProbe() {
  const open = useAnyModalOpen();
  return <span data-testid="registry">{open ? "open" : "closed"}</span>;
}

const registry = () => screen.getByTestId("registry").textContent;

function press(key: string, opts: { shiftKey?: boolean; target?: Element } = {}) {
  const target = opts.target ?? document.activeElement ?? document.body;
  fireEvent.keyDown(target, { key, shiftKey: opts.shiftKey ?? false, bubbles: true });
}

beforeEach(() => {
  __resetModalRegistry();
});

afterEach(() => {
  cleanup();
  __resetModalRegistry();
  vi.clearAllMocks();
});

describe("useModalChrome Escape", () => {
  it("closes the modal exactly once per press", () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} />);
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when Escape comes from a text field inside the modal", () => {
    // These are form fields with no Escape semantics of their own. Contrast the rename inputs
    // in `PlaylistDetail`/`TagTreeTab`, which own Escape to revert - the hook is scoped to the
    // modal container precisely so it cannot reach those.
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose}>
        <input aria-label="name" />
      </Modal>,
    );
    const field = screen.getByLabelText("name");
    field.focus();
    press("Escape", { target: field });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close while the modal reports itself unclosable", () => {
    // The save-in-flight gate. Escape must not be a second route around a disabled Cancel.
    const onClose = vi.fn();
    render(<Modal onClose={onClose} closable={false} />);
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("re-arms as soon as the modal becomes closable again", () => {
    const onClose = vi.fn();
    function Harness() {
      const [saving, setSaving] = useState(true);
      return (
        <>
          <button onClick={() => setSaving(false)}>done saving</button>
          <Modal onClose={onClose} closable={!saving} />
        </>
      );
    }
    render(<Harness />);
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("done saving"));
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives Escape to the topmost modal only, and never collapses the stack", () => {
    // The failure this hook exists to prevent: two open modals, one press, both closing.
    // Registration order decides who is topmost, not listener order - nothing here calls
    // `stopPropagation`, so listener order decides nothing at all.
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    render(
      <>
        <Modal onClose={closeBottom} label="bottom" />
        <Modal onClose={closeTop} label="top" />
      </>,
    );
    press("Escape");
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();
  });

  it("hands Escape back to the layer beneath once the top modal unmounts", () => {
    const closeBottom = vi.fn();
    function Harness() {
      const [topOpen, setTopOpen] = useState(true);
      return (
        <>
          <Modal onClose={closeBottom} label="bottom" />
          {topOpen && <Modal onClose={() => setTopOpen(false)} label="top" />}
        </>
      );
    }
    render(<Harness />);
    press("Escape");
    expect(closeBottom).not.toHaveBeenCalled();
    press("Escape");
    expect(closeBottom).toHaveBeenCalledTimes(1);
  });
});

describe("useModalChrome registry", () => {
  it("reports open while a modal is mounted and closed after it unmounts", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <RegistryProbe />
          <button onClick={() => setOpen((o) => !o)}>toggle</button>
          {open && <Modal onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Harness />);
    expect(registry()).toBe("closed");
    fireEvent.click(screen.getByText("toggle"));
    expect(registry()).toBe("open");
    fireEvent.click(screen.getByText("toggle"));
    expect(registry()).toBe("closed");
  });

  it("stays open while any modal of a stack remains", () => {
    function Harness() {
      const [topOpen, setTopOpen] = useState(true);
      return (
        <>
          <RegistryProbe />
          <Modal onClose={() => {}} label="bottom" />
          {topOpen && <Modal onClose={() => setTopOpen(false)} label="top" />}
        </>
      );
    }
    render(<Harness />);
    expect(registry()).toBe("open");
    press("Escape");
    expect(registry()).toBe("open");
  });

  it("does not deregister when the dialog element is replaced mid-life", () => {
    // Registration is keyed to the mount, not to the node. If it were tied to the element, a
    // re-render that swaps the dialog node would briefly empty the registry and let the layer
    // underneath steal the next Escape.
    function Harness() {
      const [n, setN] = useState(0);
      return (
        <>
          <RegistryProbe />
          <button onClick={() => setN((x) => x + 1)}>rerender</button>
          <Modal onClose={() => {}} label={`dialog-${n}`} />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByText("rerender"));
    fireEvent.click(screen.getByText("rerender"));
    expect(registry()).toBe("open");
  });
});

describe("useModalChrome focus", () => {
  it("moves focus into the modal when nothing inside holds it", () => {
    render(<Modal onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("leaves an autofocused field alone", () => {
    // `SmartPlaylistModal` and `ArtistMergeModal` both autofocus a field that is not first in
    // the DOM; the trap must not yank focus off it.
    render(
      <Modal onClose={() => {}}>
        <button>first</button>
        <input aria-label="name" autoFocus />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("name"));
  });

  it("wraps Tab from the last focusable back to the first", () => {
    render(<Modal onClose={() => {}} />);
    screen.getByText("last").focus();
    press("Tab");
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps Shift+Tab from the first focusable back to the last", () => {
    render(<Modal onClose={() => {}} />);
    screen.getByText("first").focus();
    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("leaves interior Tab movement to the browser", () => {
    // Only the two wrap points are intercepted. Anything else and the trap would have to
    // reimplement tab order, which is where hand-rolled traps go wrong.
    render(
      <Modal onClose={() => {}}>
        <button>first</button>
        <button>middle</button>
        <button>last</button>
      </Modal>,
    );
    screen.getByText("middle").focus();
    const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    screen.getByText("middle").dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("skips disabled controls when choosing the wrap targets", () => {
    render(
      <Modal onClose={() => {}}>
        <button disabled>disabled</button>
        <button>first</button>
        <button>last</button>
      </Modal>,
    );
    screen.getByText("first").focus();
    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("restores focus to the opener on unmount", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          {open && <Modal onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByText("opener");
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByText("first"));
    act(() => { press("Escape"); });
    expect(document.activeElement).toBe(opener);
  });

  it("falls back to the body when the opener was removed while the modal was open", () => {
    // The normal path for `IdentifyDialog`: the opener is a `ContextMenu` item, and the menu
    // unmounts on select. A handle another party can invalidate is not a liveness test, so
    // restoration checks `isConnected` rather than non-null.
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          {!open && <button onClick={() => setOpen(true)}>transient opener</button>}
          {open && <Modal onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByText("transient opener");
    opener.focus();
    fireEvent.click(opener);
    expect(opener.isConnected).toBe(false);
    act(() => { press("Escape"); });
    expect(document.activeElement).toBe(document.body);
  });
});

describe("useModalChrome markup", () => {
  it("marks the dialog element as a modal dialog for assistive tech", () => {
    render(<Modal onClose={() => {}} label="Identify Album" />);
    const dialog = screen.getByRole("dialog", { name: "Identify Album" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });
});

describe("useModalChrome waste", () => {
  it("registers exactly one keydown listener per open modal", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Modal onClose={() => {}} />);
    const added = add.mock.calls.filter(([type]) => type === "keydown").length;
    expect(added).toBe(1);
    unmount();
    const removed = remove.mock.calls.filter(([type]) => type === "keydown").length;
    expect(removed).toBe(1);
    add.mockRestore();
    remove.mockRestore();
  });

  it("does not re-register the listener when unrelated props change", () => {
    // The handler reads `onClose` and `closable` through refs, so a caller passing a fresh
    // closure per render must not tear the listener down and reinstall it - the same property
    // `useSearchShortcuts` had to be fixed for.
    const add = vi.spyOn(window, "addEventListener");
    function Harness() {
      const [n, setN] = useState(0);
      return (
        <>
          <button onClick={() => setN((x) => x + 1)}>bump</button>
          <Modal onClose={() => void n} closable={n % 2 === 0} />
        </>
      );
    }
    render(<Harness />);
    const baseline = add.mock.calls.filter(([type]) => type === "keydown").length;
    fireEvent.click(screen.getByText("bump"));
    fireEvent.click(screen.getByText("bump"));
    fireEvent.click(screen.getByText("bump"));
    const after = add.mock.calls.filter(([type]) => type === "keydown").length;
    expect(after).toBe(baseline);
    add.mockRestore();
  });
});
