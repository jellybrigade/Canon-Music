// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoteNoticeBanner } from "./RemoteNoticeBanner";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

describe("RemoteNoticeBanner", () => {
  it("labels the link with the site it opens", () => {
    render(
      <RemoteNoticeBanner
        notice={{ id: "n1", message: "Hello", link: { href: "https://example.org/a", host: "example.org" } }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Open example.org" })).toBeTruthy();
  });

  it("shows no link button for a notice without a link", () => {
    const { container } = render(<RemoteNoticeBanner notice={{ id: "n1", message: "Hello" }} onDismiss={() => {}} />);
    expect(container.querySelector(".remote-notice-banner-message")).toBeTruthy();
    expect(container.querySelector(".remote-notice-banner-link")).toBeNull();
  });
});
