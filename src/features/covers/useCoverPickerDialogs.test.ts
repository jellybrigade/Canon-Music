// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCoverPickerDialogs } from "./useCoverPickerDialogs";

describe("useCoverPickerDialogs", () => {
  it("goes back to the cover picker once Identify, opened from it, closes", () => {
    const { result } = renderHook(() => useCoverPickerDialogs<string>());
    act(() => result.current.openPicker("album-1"));
    act(() => result.current.identifyFromPicker());
    expect(result.current).toMatchObject({ pickerTarget: null, identifyTarget: "album-1" });

    act(() => result.current.closeIdentify());
    expect(result.current).toMatchObject({ pickerTarget: "album-1", identifyTarget: null });
  });

  it("closes Identify opened on its own without opening the picker", () => {
    const { result } = renderHook(() => useCoverPickerDialogs<string>());
    act(() => result.current.openIdentify("album-2"));
    act(() => result.current.closeIdentify());
    expect(result.current).toMatchObject({ pickerTarget: null, identifyTarget: null });
  });

  it("closes both once the page moves to another album, so coming back doesn't reopen them", () => {
    const { result, rerender } = renderHook(({ albumId }) => useCoverPickerDialogs<string>(albumId), {
      initialProps: { albumId: "album-1" },
    });
    act(() => result.current.openPicker("album-1"));
    act(() => result.current.identifyFromPicker());

    rerender({ albumId: "album-2" });
    rerender({ albumId: "album-1" });
    expect(result.current).toMatchObject({ pickerTarget: null, identifyTarget: null });
  });

  it("keeps the picker open while the page stays on its album", () => {
    const { result, rerender } = renderHook(({ albumId }) => useCoverPickerDialogs<string>(albumId), {
      initialProps: { albumId: "album-1" },
    });
    act(() => result.current.openPicker("album-1"));
    rerender({ albumId: "album-1" });
    expect(result.current.pickerTarget).toBe("album-1");
  });
});
