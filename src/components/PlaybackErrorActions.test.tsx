// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PlaybackErrorActions } from "./PlaybackErrorActions";

function setup(cause: "stale-track-id" | null) {
  const onRetry = vi.fn();
  const onSkip = vi.fn();
  const onOpenResync = vi.fn();
  render(
    <PlaybackErrorActions
      cause={cause}
      onRetry={onRetry}
      onSkip={onSkip}
      skipDisabled={false}
      onOpenResync={onOpenResync}
    />
  );
  return { onRetry, onSkip, onOpenResync };
}

describe("PlaybackErrorActions", () => {
  it("offers only retry and skip for a failure with no named cause", () => {
    setup(null);

    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.getByText("Skip")).toBeTruthy();
    expect(screen.queryByText("Resync library")).toBeNull();
  });

  it("offers the library resync when the server no longer knows the track id", () => {
    setup("stale-track-id");

    expect(screen.getByText("Resync library")).toBeTruthy();
  });

  it("opens the resync control once per click, without retrying or skipping", async () => {
    const user = userEvent.setup();
    const { onRetry, onSkip, onOpenResync } = setup("stale-track-id");

    await user.click(screen.getByText("Resync library"));

    expect(onOpenResync).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(0);
    expect(onSkip).toHaveBeenCalledTimes(0);
  });

  it("disables skip without disabling the other actions", () => {
    const onRetry = vi.fn();
    const onSkip = vi.fn();
    const onOpenResync = vi.fn();
    render(
      <PlaybackErrorActions
        cause="stale-track-id"
        onRetry={onRetry}
        onSkip={onSkip}
        skipDisabled
        onOpenResync={onOpenResync}
      />
    );

    expect((screen.getByText("Skip") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Retry") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText("Resync library") as HTMLButtonElement).disabled).toBe(false);
  });
});
