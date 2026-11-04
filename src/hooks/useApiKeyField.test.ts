// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { useApiKeyField } from "./useApiKeyField";

function typeEvent(value: string): ChangeEvent<HTMLInputElement> {
  return { target: { value } } as ChangeEvent<HTMLInputElement>;
}

function keyEvent(key: string): KeyboardEvent<HTMLInputElement> {
  return { key } as KeyboardEvent<HTMLInputElement>;
}

function setup(stored: string | null = null) {
  const load = vi.fn(async () => stored);
  const save = vi.fn(async (_key: string) => {});
  const onSaved = vi.fn();
  const hook = renderHook(() => useApiKeyField({ load, save, onSaved }));
  return { load, save, onSaved, ...hook };
}

function typeKey(result: { current: ReturnType<typeof useApiKeyField> }, key: string) {
  act(() => result.current.inputProps.onFocus());
  for (let i = 1; i <= key.length; i++) {
    act(() => result.current.inputProps.onChange(typeEvent(key.slice(0, i))));
  }
}

describe("useApiKeyField", () => {
  it("saves nothing while the key is typed", async () => {
    const { result, save, load } = setup();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    typeKey(result, "abcdef123456");
    await act(async () => {});

    expect(save).toHaveBeenCalledTimes(0);
    expect(result.current.inputProps.value).toBe("abcdef123456");
  });

  it("saves the whole key once when the field loses focus", async () => {
    const { result, save, onSaved, load } = setup();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    typeKey(result, "abcdef123456");

    act(() => result.current.inputProps.onBlur());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abcdef123456");
  });

  it("saves on Enter and not again on the blur that follows", async () => {
    const { result, save, onSaved, load } = setup();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    typeKey(result, "abcdef123456");

    act(() => result.current.inputProps.onKeyDown(keyEvent("Enter")));
    act(() => result.current.inputProps.onBlur());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves nothing when the field loses focus unchanged", async () => {
    const { result, save } = setup("storedkey12345");
    await waitFor(() => expect(result.current.inputProps.value).toBe("stor••••••••2345"));

    act(() => result.current.inputProps.onFocus());
    act(() => result.current.inputProps.onBlur());

    await act(async () => {});
    expect(save).toHaveBeenCalledTimes(0);
  });

  it("saves a key still being edited when the field goes away", async () => {
    const { result, save, load, unmount } = setup();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    typeKey(result, "abcdef123456");

    unmount();

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith("abcdef123456");
  });

  it("keeps what was typed when the stored key arrives late", async () => {
    let resolveLoad: (key: string | null) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const save = vi.fn(async (_key: string) => {});
    const { result } = renderHook(() => useApiKeyField({ load, save }));
    typeKey(result, "typedkey");

    await act(async () => resolveLoad("storedkey12345"));

    expect(result.current.inputProps.value).toBe("typedkey");
  });

  it("tries again on the next blur after a save failed", async () => {
    const load = vi.fn(async () => null);
    const save = vi.fn(async (_key: string) => {}).mockRejectedValueOnce(new Error("locked"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useApiKeyField({ load, save }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    typeKey(result, "abcdef123456");

    act(() => result.current.inputProps.onBlur());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await act(async () => {});
    act(() => result.current.inputProps.onFocus());
    act(() => result.current.inputProps.onBlur());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });
});
