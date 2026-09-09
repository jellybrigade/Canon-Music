// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Update } from "@tauri-apps/plugin-updater";
import { UpdatePrompt } from "./UpdatePrompt";
import { __resetModalRegistry, useAnyModalOpen } from "../hooks/useModalChrome";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.48.3") }));
// Never resolves: the prompt stays in its installing state for the duration of the case.
vi.mock("../lib/updater", () => ({ installAndRestart: () => new Promise(() => {}) }));

const update = { version: "0.49.0", body: "" } as unknown as Update;

beforeEach(() => {
  __resetModalRegistry();
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function Probe() {
  return <span data-testid="any-modal">{String(useAnyModalOpen())}</span>;
}

const later = () => screen.getByRole("button", { name: "Later" });
const install = () => screen.getByRole("button", { name: "Install & Restart" });

describe("UpdatePrompt", () => {
  it("dismisses on Escape", () => {
    const onDismiss = vi.fn();
    render(<UpdatePrompt update={update} onDismiss={onDismiss} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape once the install is under way", async () => {
    // Escape is the keyboard route to Later, so it stands down exactly when Later does.
    const onDismiss = vi.fn();
    render(<UpdatePrompt update={update} onDismiss={onDismiss} />);
    fireEvent.click(install());
    await waitFor(() => expect(later()).toBeDisabled());

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("registers as an open modal so the layers underneath stand down", () => {
    render(
      <>
        <Probe />
        <UpdatePrompt update={update} onDismiss={vi.fn()} />
      </>,
    );

    expect(screen.getByTestId("any-modal")).toHaveTextContent("true");
  });

  it("does not dismiss on a backdrop click", () => {
    // Deliberately not a backdrop-dismissible modal: the two actions are the whole point of
    // the prompt, and a stray click past its edge should not count as declining the update.
    const onDismiss = vi.fn();
    render(<UpdatePrompt update={update} onDismiss={onDismiss} />);
    const backdrop = document.querySelector(".update-prompt-backdrop")!;

    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
