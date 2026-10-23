// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { __resetKeyboardOwners, useOverlayAbove, useOwnKeyboard } from "./keyboardOwners";
import { __resetModalRegistry, useModalChrome } from "./useModalChrome";

afterEach(() => {
  __resetKeyboardOwners();
  __resetModalRegistry();
});

describe("useOverlayAbove", () => {
  it("holds while any owner holds, and lets go once the last one does", () => {
    const above = renderHook(() => useOverlayAbove());
    const first = renderHook(({ isOwning }) => useOwnKeyboard(isOwning), { initialProps: { isOwning: true } });
    const second = renderHook(() => useOwnKeyboard(true));
    expect(above.result.current).toBe(true);

    first.rerender({ isOwning: false });
    expect(above.result.current).toBe(true);
    second.unmount();
    expect(above.result.current).toBe(false);
  });

  it("counts an open modal too", () => {
    const above = renderHook(() => useOverlayAbove());
    expect(above.result.current).toBe(false);

    renderHook(() => useModalChrome(() => {}));

    expect(above.result.current).toBe(true);
  });
});
