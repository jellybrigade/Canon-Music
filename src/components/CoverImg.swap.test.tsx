// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetDecodedCovers, markCoverDecoded } from "../lib/decodedCovers";
import { COVER_SWAP_WAIT_MS, CoverImg } from "./CoverImg";

const preloads = vi.hoisted(() => {
  const pending = new Map<string, { resolve: () => void; reject: () => void }>();
  return {
    pending,
    preloadImage: vi.fn(
      (url: string) =>
        new Promise<void>((resolve, reject) => {
          pending.set(url, { resolve, reject });
        }),
    ),
  };
});

vi.mock("../lib/preloadImage", () => ({ preloadImage: preloads.preloadImage }));

const FIRST = "cover://localhost/cover/srv/al-first?size=300";
const SECOND = "cover://localhost/cover/srv/al-second?size=300";
const THIRD = "cover://localhost/cover/srv/al-third?size=300";

beforeEach(() => {
  preloads.pending.clear();
  preloads.preloadImage.mockClear();
  forgetDecodedCovers();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderLoaded(src: string) {
  const view = render(<CoverImg src={src} alt="" />);
  const image = () => view.container.querySelector("img") as HTMLImageElement;
  fireEvent.load(image());
  return { ...view, image };
}

async function settle(url: string, outcome: "resolve" | "reject") {
  await act(async () => {
    preloads.pending.get(url)?.[outcome]();
  });
}

describe("CoverImg swapping", () => {
  it("stays hidden until its cover loads, then fades in", () => {
    const { container } = render(<CoverImg src={FIRST} alt="" />);
    const image = container.querySelector("img") as HTMLImageElement;
    expect(image.dataset.cover).toBe("loading");

    fireEvent.load(image);
    expect(image.dataset.cover).toBe("entering");
  });

  it("shows a cover the browser already has without fading it in", () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    const width = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(300);
    try {
      const { container } = render(<CoverImg src={FIRST} alt="" />);
      expect(container.querySelector("img")?.dataset.cover).toBe("shown");
    } finally {
      complete.mockRestore();
      width.mockRestore();
    }
  });

  it("shows a cover decoded before from its first frame, never hidden", () => {
    markCoverDecoded(FIRST);
    const { container } = render(<CoverImg src={FIRST} alt="" />);
    expect(container.querySelector("img")?.dataset.cover).toBe("shown");
  });

  it("shows a cover another image already loaded from its first frame", () => {
    const first = render(<CoverImg src={FIRST} alt="" />);
    fireEvent.load(first.container.querySelector("img") as HTMLImageElement);

    const second = render(<CoverImg src={FIRST} alt="" />);
    expect(second.container.querySelector("img")?.dataset.cover).toBe("shown");
  });

  it("shows a broken cover rather than hiding it, and still tells the caller", () => {
    const onError = vi.fn();
    const { container } = render(<CoverImg src={FIRST} alt="" onError={onError} />);
    const image = container.querySelector("img") as HTMLImageElement;
    fireEvent.error(image);
    expect(image.dataset.cover).toBe("broken");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("still tells the caller when its cover loads", () => {
    const onLoad = vi.fn();
    const { container } = render(<CoverImg src={FIRST} alt="" onLoad={onLoad} />);
    fireEvent.load(container.querySelector("img") as HTMLImageElement);
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("keeps the shown cover until the next one has loaded", async () => {
    const { rerender, image } = renderLoaded(FIRST);

    rerender(<CoverImg src={SECOND} alt="" />);
    expect(image().getAttribute("src")).toBe(FIRST);
    expect(preloads.preloadImage).toHaveBeenCalledTimes(1);
    expect(preloads.preloadImage).toHaveBeenCalledWith(SECOND);

    await settle(SECOND, "resolve");
    expect(image().getAttribute("src")).toBe(SECOND);
    expect(image().dataset.cover).not.toBe("loading");
  });

  it("swaps to a next cover that failed to load, so the caller's error handling runs", async () => {
    const { rerender, image } = renderLoaded(FIRST);
    rerender(<CoverImg src={SECOND} alt="" />);

    await settle(SECOND, "reject");
    expect(image().getAttribute("src")).toBe(SECOND);
  });

  it("stops holding the old cover once the next one is slow to arrive", () => {
    vi.useFakeTimers();
    const { rerender, image } = renderLoaded(FIRST);
    rerender(<CoverImg src={SECOND} alt="" />);

    act(() => vi.advanceTimersByTime(COVER_SWAP_WAIT_MS - 1));
    expect(image().getAttribute("src")).toBe(FIRST);

    act(() => vi.advanceTimersByTime(1));
    expect(image().getAttribute("src")).toBe(SECOND);
    expect(image().dataset.cover).toBe("loading");
  });

  it("swaps at once from a cover that failed", () => {
    const { container, rerender } = render(<CoverImg src={FIRST} alt="" />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    rerender(<CoverImg src={SECOND} alt="" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(SECOND);
    expect(preloads.preloadImage).toHaveBeenCalledTimes(0);
  });

  it("swaps at once while nothing is on screen yet", () => {
    const { container, rerender } = render(<CoverImg src={FIRST} alt="" />);
    rerender(<CoverImg src={SECOND} alt="" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(SECOND);
    expect(preloads.preloadImage).toHaveBeenCalledTimes(0);
  });

  it("never shows a cover it was asked for and then moved past", async () => {
    const { rerender, image } = renderLoaded(FIRST);
    rerender(<CoverImg src={SECOND} alt="" />);
    rerender(<CoverImg src={THIRD} alt="" />);

    await settle(SECOND, "resolve");
    expect(image().getAttribute("src")).toBe(FIRST);

    await settle(THIRD, "resolve");
    expect(image().getAttribute("src")).toBe(THIRD);
  });

  it("leaves no timer behind when unmounted mid-swap", () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderLoaded(FIRST);
    rerender(<CoverImg src={SECOND} alt="" />);
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
