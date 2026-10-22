// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/itunes", () => ({ fetchItunesCoverArt: vi.fn() }));

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { fetchItunesCoverArt } from "../clients/itunes";
import { AlbumArt } from "./AlbumArt";

function firstImage(container: HTMLElement): HTMLImageElement {
  const image = container.querySelector("img");
  if (!image) throw new Error("no cover rendered");
  return image;
}

afterEach(() => {
  cleanup();
  vi.mocked(fetchItunesCoverArt).mockReset();
});

describe("AlbumArt", () => {
  it("keeps the new album's cover when the old one's fallback answers late", async () => {
    let answer: (url: string | null) => void = () => {};
    vi.mocked(fetchItunesCoverArt).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { container, rerender } = render(<AlbumArt src="cover://a" artist="A" album="First" />);
    const image = () => container.querySelector("img");
    fireEvent.error(firstImage(container));

    rerender(<AlbumArt src="cover://b" artist="B" album="Second" />);
    await act(async () => {
      answer("https://itunes/first.jpg");
    });

    expect(image()?.getAttribute("src")).toBe("cover://b");
  });

  it("shows the fallback for the cover that failed", async () => {
    vi.mocked(fetchItunesCoverArt).mockResolvedValue("https://itunes/first.jpg");
    const { container } = render(<AlbumArt src="cover://a" artist="A" album="First" />);

    await act(async () => {
      fireEvent.error(firstImage(container));
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://itunes/first.jpg");
  });
});
