// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DatabaseErrorScreen } from "./DatabaseErrorScreen";
import { SchemaTooNewError } from "../db/migrations";

afterEach(cleanup);

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
});
