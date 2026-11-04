// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingRow } from "./SettingRow";

describe("SettingRow", () => {
  it("names its control group after the setting and describes it", () => {
    render(
      <SettingRow title="Restore queue on startup" description="Restores your last queue.">
        <input type="checkbox" />
      </SettingRow>,
    );
    const group = screen.getByRole("group", { name: "Restore queue on startup" });
    expect(group.getAttribute("aria-describedby")).not.toBeNull();
    expect(document.getElementById(group.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Restores your last queue.",
    );
  });

  it("leaves the description reference off when there is none", () => {
    render(
      <SettingRow title="Max queue size">
        <select />
      </SettingRow>,
    );
    expect(screen.getByRole("group", { name: "Max queue size" }).hasAttribute("aria-describedby")).toBe(false);
  });
});
