// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.53.0") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../db";
import { __resetSettingCache } from "../../../hooks/useSetting";
import { createMigratedTestDb } from "../../../test/sqlite";
import { AboutTab } from "./AboutTab";

const { check } = vi.hoisted(() => ({ check: vi.fn() }));

beforeEach(async () => {
  __resetSettingCache();
  const db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  check.mockReset();
});
afterEach(cleanup);

describe("AboutTab update check", () => {
  it("says the check failed instead of claiming Canon is up to date", async () => {
    check.mockRejectedValue(new Error("Could not fetch a valid release JSON from the remote"));
    render(<AboutTab searchQuery="" />);

    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByText("Couldn't check for updates.")).toBeInTheDocument();
    expect(screen.queryByText("You're up to date.")).not.toBeInTheDocument();
  });

  it("says up to date when the feed has nothing newer", async () => {
    check.mockResolvedValue(null);
    render(<AboutTab searchQuery="" />);

    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByText("You're up to date.")).toBeInTheDocument();
  });

  it("says why the install failed instead of silently offering it again", async () => {
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error("signature verification failed"));
    check.mockResolvedValue({ available: true, version: "0.99.0", downloadAndInstall });
    render(<AboutTab searchQuery="" />);

    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await userEvent.click(await screen.findByRole("button", { name: "Install & Restart" }));

    expect(await screen.findByText("Couldn't install the update: signature verification failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install & Restart" })).toBeEnabled();
  });
});
