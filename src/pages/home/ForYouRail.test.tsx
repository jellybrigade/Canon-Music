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
  },
];

function renderUnlockedRail(perTab = 6) {
  const onPerTabChange = vi.fn<(count: number) => void>();
  render(
    <ForYouRail
      groups={GROUPS}
      serverWithCred={SERVER}
      onSelectAlbum={vi.fn()}
      playAlbum={vi.fn()}
      onRefresh={vi.fn()}
      onCardContextMenu={vi.fn()}
      config={DEFAULT_FOR_YOU_CONFIG}
      onConfigChange={vi.fn()}
      perTab={perTab}
      onPerTabChange={onPerTabChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Unlock tab reordering" }));
  const input = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Albums per tab" });
  return { input, onPerTabChange };
}

describe("ForYouRail albums per tab", () => {
  it("takes any typed count once the field is left", () => {
    const { input, onPerTabChange } = renderUnlockedRail();
    fireEvent.change(input, { target: { value: "5" } });
    expect(onPerTabChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onPerTabChange).toHaveBeenCalledExactlyOnceWith(5);
  });

  it("takes the count on Enter", () => {
    const { input, onPerTabChange } = renderUnlockedRail();
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPerTabChange).toHaveBeenCalledExactlyOnceWith(10);
  });

  it("keeps the saved count when the field is cleared or Escape is pressed", () => {
    const { input, onPerTabChange } = renderUnlockedRail(6);
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
