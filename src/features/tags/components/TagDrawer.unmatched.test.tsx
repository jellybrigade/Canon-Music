// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({
  getDb: () => Promise.resolve({ select: () => Promise.resolve([{ raw_value: "shoe gaze", source: "file" }]) }),
}));
vi.mock("../lib/canonicalize", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/canonicalize")>()),
  getCanonTree: () => Promise.reject(new Error("database is locked")),
}));
vi.mock("../hooks/useTagMappings", () => ({ useTagMappings: () => ({ saveMapping: vi.fn() }) }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { UnmatchedSection } from "./TagDrawer";

afterEach(cleanup);

describe("UnmatchedSection", () => {
  it("says the genre tree could not be read instead of offering an empty picker", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <UnmatchedSection albumId="srv:alb1" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("Couldn't load the genre tree")).toBeInTheDocument());
    expect(screen.getByText("shoe gaze")).toBeInTheDocument();
  });
});
