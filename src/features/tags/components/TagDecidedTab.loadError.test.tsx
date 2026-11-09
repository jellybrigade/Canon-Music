// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const select = vi.fn();
vi.mock("../../../db", () => ({ getDb: () => Promise.resolve({ select }) }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { TagDecidedTab } from "./TagDecidedTab";

afterEach(() => {
  cleanup();
  select.mockReset();
});

describe("TagDecidedTab", () => {
  it("says the decisions could not be read instead of claiming there are none", async () => {
    select.mockRejectedValue(new Error("database is locked"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TagDecidedTab treeNodes={[]} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("Couldn't load your tag decisions")).toBeInTheDocument());
    expect(screen.queryByText("No decisions yet")).not.toBeInTheDocument();
  });
});
