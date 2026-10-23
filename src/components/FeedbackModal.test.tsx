// @vitest-environment jsdom

import { getVersion } from "@tauri-apps/api/app";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boundedFetch, UPLOAD_TIMEOUT_MS } from "../clients/boundedFetch";
import { logger } from "../lib/logger";
import { __resetModalRegistry, useAnyModalOpen } from "../ui/useModalChrome";
import { FeedbackModal } from "./FeedbackModal";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(() => Promise.resolve("0.48.3")) }));
vi.mock("../clients/boundedFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../clients/boundedFetch")>()),
  boundedFetch: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
}));
vi.mock("../lib/logger", async (importOriginal) => ({
  formatLogValue: (await importOriginal<typeof import("../lib/logger")>()).formatLogValue,
  logger: { getRecent: () => Promise.resolve(""), error: vi.fn() },
}));

beforeEach(() => {
  __resetModalRegistry();
  vi.stubEnv("VITE_DISCORD_WEBHOOK", "https://discord.example/webhook");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function Probe() {
  return <span data-testid="any-modal">{String(useAnyModalOpen())}</span>;
}

const backdrop = () => document.querySelector(".feedback-overlay")!;
const dialog = () => document.querySelector(".feedback-modal")!;

describe("FeedbackModal", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when press and release both land on the backdrop", () => {
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} />);

    fireEvent.mouseDown(backdrop());
    fireEvent.click(backdrop());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the report when a drag starts inside and releases on the backdrop", () => {
    // Selecting text in the steps field and releasing past the edge of the dialog fires a
    // click on the backdrop, because the backdrop is the common ancestor of press and
    // release. Dismissing on that click discards the whole half-written report.
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} />);

    fireEvent.mouseDown(dialog());
    fireEvent.click(backdrop());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("registers as an open modal so the layers underneath stand down", () => {
    render(
      <>
        <Probe />
        <FeedbackModal onClose={vi.fn()} />
      </>,
    );

    expect(screen.getByTestId("any-modal")).toHaveTextContent("true");
  });

  it("leaves the registry empty once closed", () => {
    const { unmount } = render(<FeedbackModal onClose={vi.fn()} />);
    unmount();

    render(<Probe />);

    expect(screen.getByTestId("any-modal")).toHaveTextContent("false");
  });

  it("gives the upload with attached logs the long deadline", async () => {
    render(<FeedbackModal onClose={vi.fn()} />);

    fireEvent.change(document.querySelector(".feedback-textarea")!, { target: { value: "Love it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(boundedFetch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(boundedFetch).mock.calls[0]?.[2]).toEqual({ headersTimeoutMs: UPLOAD_TIMEOUT_MS });
  });

  it("does not close a later report once this one was closed by hand", async () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      const { unmount } = render(<FeedbackModal onClose={onClose} />);
      fireEvent.change(document.querySelector(".feedback-textarea")!, { target: { value: "Love it" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await vi.waitFor(() => expect(screen.getByText("Sent! Thanks.")).toBeInTheDocument());

      unmount();
      vi.advanceTimersByTime(5000);

      expect(onClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the server host it will send beside the system info box", () => {
    render(<FeedbackModal serverUrl="https://music.example.org:4533" onClose={vi.fn()} />);

    expect(document.querySelector(".feedback-sysinfo-detail")).toHaveTextContent("music.example.org");
  });

  it("attaches a report longer than Discord takes in a message instead of failing", async () => {
    vi.mocked(boundedFetch).mockClear();
    render(<FeedbackModal onClose={vi.fn()} />);
    const longText = "a".repeat(5000);

    fireEvent.click(screen.getByRole("checkbox", { name: "Include recent logs" }));
    fireEvent.change(document.querySelector(".feedback-textarea")!, { target: { value: longText } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(boundedFetch).toHaveBeenCalledTimes(1));
    const body = vi.mocked(boundedFetch).mock.calls[0]?.[1]?.body;
    if (!(body instanceof FormData)) throw new Error("expected a multipart upload");
    const payload = JSON.parse(String(body.get("payload_json")));
    expect(payload.embeds[0].description.length).toBeLessThanOrEqual(4096);
    const attached = body.get("files[0]");
    if (!(attached instanceof Blob)) throw new Error("expected the full text attached");
    expect(await attached.text()).toContain(longText);
  });

  it("logs why a send failed", async () => {
    vi.mocked(boundedFetch).mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 429 })));
    render(<FeedbackModal onClose={vi.fn()} />);

    fireEvent.change(document.querySelector(".feedback-textarea")!, { target: { value: "Love it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Send failed, try again")).toBeInTheDocument());
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("HTTP 429"));
  });

  it("says feedback can't be sent from a build without a destination instead of failing every send", () => {
    vi.stubEnv("VITE_DISCORD_WEBHOOK", "");
    render(<FeedbackModal onClose={vi.fn()} />);

    fireEvent.change(document.querySelector(".feedback-textarea")!, { target: { value: "Love it" } });

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/can't send feedback/i)).toBeInTheDocument();
  });

  it("reports an unknown version when the version read fails", async () => {
    vi.mocked(getVersion).mockImplementationOnce(() => Promise.reject(new Error("ipc down")));
    render(<FeedbackModal onClose={vi.fn()} />);

    await waitFor(() => expect(document.querySelector(".feedback-sysinfo-detail")).toHaveTextContent("vunknown"));
  });

  it("does not cut an emoji in half where an overlong report is shortened", async () => {
    vi.mocked(boundedFetch).mockClear();
    render(<FeedbackModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Include system info/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Include recent logs" }));
    fireEvent.change(document.querySelector(".feedback-textarea")!, { target: { value: `a${"🎵".repeat(3000)}` } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(boundedFetch).toHaveBeenCalledTimes(1));
    const body = vi.mocked(boundedFetch).mock.calls[0]?.[1]?.body;
    if (!(body instanceof FormData)) throw new Error("expected a multipart upload");
    const description: string = JSON.parse(String(body.get("payload_json"))).embeds[0].description;
    expect(description.length).toBeLessThanOrEqual(4096);
    expect(description).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});
