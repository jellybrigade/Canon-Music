// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { SyncErrorBanner, bannerMessage, formatCountdown } from "./SyncErrorBanner";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

function renderBanner(props: Partial<Parameters<typeof SyncErrorBanner>[0]> = {}) {
  return render(
    <SyncErrorBanner
      variant="error"
      serverName="Navi"
      detail="getAlbumList2 failed after 3 attempts: timed out after 12000ms"
      nextRetryAt={null}
      onRetry={() => {}}
      {...props}
    />,
  );
}

function text(container: HTMLElement): string {
  return container.querySelector(".sync-status")?.textContent ?? "";
}

function retryButton(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>(".sync-retry-btn");
  if (!btn) throw new Error("no retry button rendered");
  return btn;
}

describe("formatCountdown", () => {
  it.each([
    [0, "0s"],
    [1, "1s"],
    [999, "1s"],
    [SECOND, "1s"],
    [28 * SECOND, "28s"],
    [59 * SECOND, "59s"],
    [MINUTE, "1m 0s"],
    [2 * MINUTE + 4 * SECOND, "2m 4s"],
    [5 * MINUTE, "5m 0s"],
  ])("renders %ims as %s", (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });

  it("floors a negative remainder at zero rather than printing a past time", () => {
    expect(formatCountdown(-5000)).toBe("0s");
  });
});

describe("bannerMessage", () => {
  it("names the mirror rather than the failure once the backoff is spent", () => {
    expect(bannerMessage("error", "Navi", null, 0)).toBe(
      "Can't reach Navi. Showing your saved library.",
    );
  });

  it("counts a pending retry down", () => {
    expect(bannerMessage("error", "Navi", 1_000, 28 * SECOND)).toBe(
      "Can't reach Navi. Retrying in 28s.",
    );
  });

  it("says the retry is happening once the countdown runs out", () => {
    expect(bannerMessage("error", "Navi", 1_000, 0)).toBe("Can't reach Navi. Retrying now…");
  });

  it("distinguishes a partial sync from an unreachable server", () => {
    expect(bannerMessage("partial", "Navi", null, 0)).toBe(
      "Couldn't fully sync Navi. Showing your saved library.",
    );
  });
});

describe("SyncErrorBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps the raw failure out of the copy and in the tooltip", () => {
    const { container } = renderBanner();

    expect(text(container)).toBe("Can't reach Navi. Showing your saved library.Retry");
    expect(text(container)).not.toContain("getAlbumList2");
    expect(container.querySelector(".sync-status")?.getAttribute("title")).toBe(
      "getAlbumList2 failed after 3 attempts: timed out after 12000ms",
    );
  });

  it("counts a pending retry down once a second", async () => {
    const { container } = renderBanner({ nextRetryAt: Date.now() + 30 * SECOND });

    expect(text(container)).toContain("Retrying in 30s.");
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * SECOND); });
    expect(text(container)).toContain("Retrying in 28s.");
  });

  it("offers to skip the wait while a retry is pending", () => {
    const onRetry = vi.fn();
    const { container } = renderBanner({ nextRetryAt: Date.now() + 30 * SECOND, onRetry });

    expect(retryButton(container).textContent).toBe("Retry now");
    fireEvent.click(retryButton(container));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers a plain retry once no retry is scheduled", () => {
    const onRetry = vi.fn();
    const { container } = renderBanner({ onRetry });

    expect(retryButton(container).textContent).toBe("Retry");
    fireEvent.click(retryButton(container));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not promise a countdown a partial sync never schedules", () => {
    const { container } = renderBanner({ variant: "partial", detail: "Sync partial: albums unchanged." });

    expect(text(container)).toBe("Couldn't fully sync Navi. Showing your saved library.Retry");
  });

  it("arms exactly one countdown across a re-arm and tears it down on unmount", async () => {
    const { rerender, unmount } = renderBanner({ nextRetryAt: Date.now() + 30 * SECOND });
    expect(vi.getTimerCount()).toBe(1);

    rerender(
      <SyncErrorBanner
        variant="error"
        serverName="Navi"
        detail="boom"
        nextRetryAt={Date.now() + 2 * MINUTE}
        onRetry={() => {}}
      />,
    );
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("arms no countdown at all when nothing is scheduled", () => {
    renderBanner();
    expect(vi.getTimerCount()).toBe(0);
  });
});
