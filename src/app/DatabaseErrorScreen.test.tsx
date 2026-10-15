// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaTooNewError } from "../db/migrations";
import { DatabaseErrorScreen } from "./DatabaseErrorScreen";

const { check, relaunch } = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));

beforeEach(() => {
  check.mockReset();
  relaunch.mockReset();
});
afterEach(cleanup);

const tooNew = () => new SchemaTooNewError(52, 51);
const updateButton = () => screen.getByRole("button", { name: "Update Canon" });

describe("DatabaseErrorScreen", () => {
  it("offers a retry for an ordinary read failure and shows the raw message", () => {
    render(<DatabaseErrorScreen error={new Error("database is locked")} onRetry={vi.fn()} />);

    expect(screen.getByText("database is locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("runs the retry handler once per click", async () => {
    const onRetry = vi.fn();
    render(<DatabaseErrorScreen error={new Error("database is locked")} onRetry={onRetry} />);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("names both versions and withholds retry for a database from a newer build", () => {
    render(<DatabaseErrorScreen error={new SchemaTooNewError(99, 48)} onRetry={vi.fn()} />);

    expect(screen.getByText("This library needs a newer Canon")).toBeInTheDocument();
    expect(screen.getByText(/database version 99/)).toBeInTheDocument();
    expect(screen.getByText(/only understands version 48/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("does not look for an update until asked", () => {
    render(<DatabaseErrorScreen error={tooNew()} onRetry={vi.fn()} />);

    expect(updateButton()).toBeInTheDocument();
    expect(check).not.toHaveBeenCalled();
  });

  it("installs the published update and restarts from the too-new screen", async () => {
    const downloadAndInstall = vi.fn(() => Promise.resolve());
    check.mockResolvedValue({ available: true, version: "0.51.0", downloadAndInstall });
    relaunch.mockResolvedValue(undefined);
    render(<DatabaseErrorScreen error={tooNew()} onRetry={vi.fn()} />);

    await userEvent.click(updateButton());

    await vi.waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledTimes(1);
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it("says so when no newer Canon is published yet, and lets the user check again", async () => {
    check.mockResolvedValue(null);
    render(<DatabaseErrorScreen error={tooNew()} onRetry={vi.fn()} />);

    await userEvent.click(updateButton());

    expect(await screen.findByText(/No newer Canon found/)).toBeInTheDocument();
    expect(updateButton()).toBeEnabled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("reports a failed check as a failure, not as no update, and retries on request", async () => {
    const downloadAndInstall = vi.fn(() => Promise.resolve());
    check
      .mockRejectedValueOnce(new Error("Could not fetch a valid release JSON from the remote"))
      .mockResolvedValueOnce({ available: true, version: "0.51.0", downloadAndInstall });
    relaunch.mockResolvedValue(undefined);
    render(<DatabaseErrorScreen error={tooNew()} onRetry={vi.fn()} />);

    await userEvent.click(updateButton());

    expect(await screen.findByText(/Could not fetch a valid release JSON/)).toBeInTheDocument();
    expect(screen.queryByText(/No newer Canon found/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await vi.waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledTimes(2);
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it("shows the install error and re-enables the button", async () => {
    const downloadAndInstall = vi.fn(() => Promise.reject(new Error("signature mismatch")));
    check.mockResolvedValue({ available: true, version: "0.51.0", downloadAndInstall });
    render(<DatabaseErrorScreen error={tooNew()} onRetry={vi.fn()} />);

    await userEvent.click(updateButton());

    expect(await screen.findByText("signature mismatch")).toBeInTheDocument();
    expect(updateButton()).toBeEnabled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("offers no update button for an ordinary read failure", () => {
    render(<DatabaseErrorScreen error={new Error("database is locked")} onRetry={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Update Canon" })).not.toBeInTheDocument();
  });
});
