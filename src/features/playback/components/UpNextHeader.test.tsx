// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("./SaveQueueForm", () => ({
  SaveQueueForm: ({ onDone }: { onDone: () => void }) => (
    <form data-form="save-queue">
      <button type="button" onClick={onDone}>
        Done
      </button>
    </form>
  ),
}));

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/playerTypes";
import { UpNextHeader } from "./UpNextHeader";

const serverWithCredential = {
  server: { id: "s1", url: "http://a", username: "u" },
  credential: "c",
} as unknown as ServerWithCredential;

function track(id: string, duration: number | null): CurrentTrack {
  return { id: `s1:${id}`, title: id, artist: null, duration };
}

const saveForm = () => document.querySelector("[data-form='save-queue']");
const saveButton = () => screen.queryByRole("button", { name: "Save as playlist" });

function renderHeader() {
  return render(<UpNextHeader serverWithCredential={serverWithCredential} />);
}

beforeEach(() => {
  usePlayerStore.setState({ queue: [track("a", 1500), track("b", 2400), track("c", null)], queueIndex: 0 });
});

afterEach(() => {
  cleanup();
});

describe("UpNextHeader", () => {
  it("sums what the queue holds, counting an unknown length as nothing", () => {
    renderHeader();
    expect(screen.getByText("3 tracks · 1 hr 5 min")).toBeTruthy();
  });

  it("is not shown on an empty queue", () => {
    usePlayerStore.setState({ queue: [] });
    const { container } = renderHeader();
    expect(container.childElementCount).toBe(0);
  });

  it("turns into the save form in place and back", () => {
    renderHeader();
    expect(saveForm()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save as playlist" }));
    expect(saveForm()).not.toBeNull();
    expect(saveButton()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(saveForm()).toBeNull();
    expect(saveButton()).not.toBeNull();
  });

  it("clears the queue from its own button, apart from Save", () => {
    const clearQueue = vi.fn();
    usePlayerStore.setState({ clearQueue });
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(clearQueue).toHaveBeenCalledTimes(1);
  });
});
