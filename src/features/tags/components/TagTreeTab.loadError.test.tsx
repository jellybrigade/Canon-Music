// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const select = vi.fn();
vi.mock("../../../db", () => ({ getDb: () => Promise.resolve({ select }) }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TagTreeTab } from "./TagTreeTab";

afterEach(() => {
  cleanup();
  select.mockReset();
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TagTreeTab
        treeNodes={[]}
        supersededCount={0}
        onCreateNode={vi.fn()}
        onEditNode={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("TagTreeTab", () => {
  it("says the custom nodes could not be read instead of claiming there are none", async () => {
    select.mockRejectedValue(new Error("database is locked"));
    mount();

    await waitFor(() => expect(screen.getByText("Couldn't load your custom nodes")).toBeInTheDocument());
    expect(screen.queryByText("No custom nodes yet.")).not.toBeInTheDocument();
  });

  it("reads the nodes again on Try again", async () => {
    select.mockRejectedValue(new Error("database is locked"));
    mount();
    await screen.findByText("Couldn't load your custom nodes");
    select.mockResolvedValue([]);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("No custom nodes yet.")).toBeInTheDocument());
  });
});
