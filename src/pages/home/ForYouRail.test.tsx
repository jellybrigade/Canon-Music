// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("../../hooks/useAlbumDisplayName", () => ({ useAlbumDisplayName: () => (name: string) => name }));
vi.mock("../../hooks/useCoverCache", () => ({ useAlbumCoverMap: () => new Map<string, string>() }));

import { fireEvent, render, screen } from "@testing-library/react";
import type { ServerWithCredential } from "../../hooks/useServer";
import { DEFAULT_FOR_YOU_CONFIG, ForYouRail } from "./ForYouRail";

const SERVER: ServerWithCredential = {
  server: {
    id: "a",
    type: "navidrome",
    url: "https://a.example",
    alt_url: null,
    display_name: "A",
    username: "u",
    created_at: "2026-01-01",
  },
  credential: { type: "apikey", apiKey: "k" },
};

const GROUPS = [
  {
    key: "loved",
    kicker: "Loved",
    albums: [{ id: "al-1", server_id: "a", name: "One", artist: null, year: null, artwork_url: "c1" }],
    isLocked: false,
  },
];

function renderRail({ perTab = 6, groups = GROUPS } = {}) {
  const onPerTabChange = vi.fn<(count: number) => void>();
  const onToggleLock = vi.fn<(key: string) => void>();
  render(
    <ForYouRail
      groups={groups}
      serverWithCred={SERVER}
      onSelectAlbum={vi.fn()}
      playAlbum={vi.fn()}
      onRefresh={vi.fn()}
      onToggleLock={onToggleLock}
      onCardContextMenu={vi.fn()}
      config={DEFAULT_FOR_YOU_CONFIG}
      onConfigChange={vi.fn()}
      perTab={perTab}
      onPerTabChange={onPerTabChange}
    />,
  );
  return { onPerTabChange, onToggleLock };
}

function renderEditingRail(perTab = 6) {
  const { onPerTabChange } = renderRail({ perTab });
  fireEvent.click(screen.getByRole("button", { name: "Edit tabs" }));
  const input = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Albums per tab" });
  return { input, onPerTabChange };
}

describe("ForYouRail tab lock", () => {
  it("locks the tab on screen and shows it as locked", () => {
    const { onToggleLock } = renderRail();
    const lock = screen.getByRole("button", { name: "Lock the Loved tab" });
    expect(lock.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(lock);
    expect(onToggleLock).toHaveBeenCalledExactlyOnceWith("loved");
  });

  it("marks a locked tab", () => {
    renderRail({ groups: [{ ...GROUPS[0]!, isLocked: true }] });
    expect(screen.getByRole("button", { name: "Lock the Loved tab" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("tab", { name: /Loved/ }).querySelector(".foryou-v2-tab__lock")).not.toBeNull();
  });
});

describe("ForYouRail albums per tab", () => {
  it("takes any typed count once the field is left", () => {
    const { input, onPerTabChange } = renderEditingRail();
    fireEvent.change(input, { target: { value: "5" } });
    expect(onPerTabChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onPerTabChange).toHaveBeenCalledExactlyOnceWith(5);
  });

  it("takes the count on Enter", () => {
    const { input, onPerTabChange } = renderEditingRail();
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPerTabChange).toHaveBeenCalledExactlyOnceWith(10);
  });

  it("takes a typed count when editing ends with the field still focused", () => {
    const { input, onPerTabChange } = renderEditingRail();
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Done editing tabs" }));
    expect(onPerTabChange).toHaveBeenCalledExactlyOnceWith(12);
  });

  it("keeps the saved count when the field is cleared or Escape is pressed", () => {
    const { input, onPerTabChange } = renderEditingRail(6);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("6");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("6");
    fireEvent.blur(input);
    expect(onPerTabChange).not.toHaveBeenCalled();
  });
});
