// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../../components/AlbumArt", () => ({ AlbumArt: () => <img alt="" className="now-playing-art" /> }));
vi.mock("./Visualizer", () => ({ Visualizer: () => <canvas className="now-playing-visualizer" /> }));
vi.mock("../../../hooks/useSetting", async () => {
  const { useCallback, useState } = await import("react");
  return {
    useBoolSetting: (key: string, defaultValue: boolean) => {
      const [value, setValue] = useState(settings.get(key) ?? defaultValue);
      const set = useCallback(
        async (next: boolean) => {
          settings.set(key, next);
          setValue(next);
        },
        [key],
      );
      return [value, set, true];
    },
  };
});

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DlnaRenderer } from "../../../clients/dlna";
import { __resetModalRegistry } from "../../../ui/useModalChrome";
import { SHOW_VISUALIZER_KEY, VISUALIZER_ENABLED_KEY } from "../lib/visualizerSettings";
import { usePlayerStore } from "../store/player";
import { plainError } from "../store/playerTypes";
import { NowPlayingArt } from "./NowPlayingArt";

const settings = new Map<string, boolean>();

function renderArt() {
  return render(<NowPlayingArt artUrl="http://a/cover" artist="Artist" album="Album" title="One" />);
}

const toggle = () => screen.queryByRole("button");
const visualizer = () => document.querySelector(".now-playing-visualizer");
const pressV = (target: Element = document.body) => act(() => void fireEvent.keyDown(target, { key: "v" }));

beforeEach(() => {
  settings.clear();
  usePlayerStore.setState({ castDevice: null, error: null });
});

afterEach(() => {
  cleanup();
  __resetModalRegistry();
  vi.unstubAllGlobals();
});

describe("NowPlayingArt", () => {
  it("shows the art until the visualizer is asked for, then remembers the choice", () => {
    renderArt();
    expect(visualizer()).toBeNull();

    fireEvent.click(toggle()!);
    expect(visualizer()).not.toBeNull();
    expect(settings.get(SHOW_VISUALIZER_KEY)).toBe(true);
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle()!);
    expect(visualizer()).toBeNull();
    expect(settings.get(SHOW_VISUALIZER_KEY)).toBe(false);
  });

  it("opens straight to the visualizer when it was left on", () => {
    settings.set(SHOW_VISUALIZER_KEY, true);
    renderArt();
    expect(visualizer()).not.toBeNull();
  });

  it("toggles with the V key, but not while typing", () => {
    renderArt();
    pressV();
    expect(visualizer()).not.toBeNull();

    const input = document.createElement("input");
    document.body.appendChild(input);
    pressV(input);
    expect(visualizer()).not.toBeNull();
    input.remove();

    pressV();
    expect(visualizer()).toBeNull();
  });

  it("arms its key listener once however often it toggles", () => {
    const addListener = vi.spyOn(document, "addEventListener");
    renderArt();
    pressV();
    pressV();
    pressV();

    expect(addListener.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
    expect(visualizer()).not.toBeNull();
    addListener.mockRestore();
  });

  it("offers nothing when turned off in settings", () => {
    settings.set(VISUALIZER_ENABLED_KEY, false);
    settings.set(SHOW_VISUALIZER_KEY, true);
    renderArt();

    expect(toggle()).toBeNull();
    expect(visualizer()).toBeNull();
    pressV();
    expect(visualizer()).toBeNull();
  });

  it("shows the art and says why while casting", () => {
    settings.set(SHOW_VISUALIZER_KEY, true);
    usePlayerStore.setState({ castDevice: { name: "TV" } as unknown as DlnaRenderer });
    renderArt();

    expect(visualizer()).toBeNull();
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    expect(toggle()!.getAttribute("title")).toMatch(/casting/);
    pressV();
    expect(visualizer()).toBeNull();
  });

  it("shows the art while the system asks for reduced motion", () => {
    settings.set(SHOW_VISUALIZER_KEY, true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    renderArt();

    expect(visualizer()).toBeNull();
    expect(toggle()!.getAttribute("title")).toMatch(/reduced motion/);
  });

  it("comes back on its own once a playback error clears", () => {
    settings.set(SHOW_VISUALIZER_KEY, true);
    usePlayerStore.setState({ error: plainError("Broken") });
    renderArt();
    expect(visualizer()).toBeNull();

    act(() => usePlayerStore.setState({ error: null }));
    expect(visualizer()).not.toBeNull();
  });
});
