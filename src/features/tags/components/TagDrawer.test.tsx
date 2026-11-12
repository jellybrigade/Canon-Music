// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetModalRegistry, useAnyModalOpen } from "../../../ui/useModalChrome";
import { TagDrawer } from "./TagDrawer";

const fixture = vi.hoisted(() => ({
  rawGenreRows: [] as { canonical_id: string; raw_value: string }[],
  genres: [] as { id: string | null; name: string; source: string }[],
}));

vi.mock("../../../db", () => ({
  getDb: () =>
    Promise.resolve({
      select: (sql: string) => Promise.resolve(sql.includes("DISTINCT tt.canonical_id") ? fixture.rawGenreRows : []),
    }),
}));
vi.mock("../lib/canonicalize", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/canonicalize")>()),
  getCanonTree: () => Promise.resolve({ nodes: [] }),
}));
vi.mock("../hooks/useNormalizeAlbum", () => ({
  useNormalizeAlbum: () => ({
    data: { genres: fixture.genres, descriptors: [], scenes: [], unresolved: [] },
    isLoading: false,
  }),
}));
vi.mock("../../enrichment/hooks/useAlbumIdentity", () => ({ useAlbumIdentity: () => ({ data: null }) }));
vi.mock("../hooks/useTagMappings", () => ({
  useTagMappings: () => ({ saveMapping: vi.fn(), data: new Map() }),
}));

beforeEach(() => {
  __resetModalRegistry();
  fixture.rawGenreRows = [];
  fixture.genres = [];
});
afterEach(cleanup);

function Probe() {
  return <span data-testid="any-modal">{String(useAnyModalOpen())}</span>;
}

function renderDrawer(onClose = vi.fn(), extra?: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      {extra}
      <TagDrawer albumId="srv:alb1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

const overlay = () => document.querySelector(".tag-drawer-overlay")!;
const drawer = () => document.querySelector(".tag-drawer")!;

describe("TagDrawer", () => {
  it("closes on Escape", () => {
    const onClose = renderDrawer();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("registers as an open modal so the layers underneath stand down", () => {
    renderDrawer(vi.fn(), <Probe />);

    expect(screen.getByTestId("any-modal")).toHaveTextContent("true");
  });

  it("stays open when a drag starts inside and releases on the overlay", () => {
    const onClose = renderDrawer();

    fireEvent.mouseDown(drawer());
    fireEvent.click(overlay());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("names the album's original spellings of a remapped genre", async () => {
    fixture.genres = [{ id: "hip-hop", name: "Hip Hop", source: "file" }];
    fixture.rawGenreRows = [
      { canonical_id: "hip-hop", raw_value: "Rap" },
      { canonical_id: "hip-hop", raw_value: "hip hop" },
    ];

    renderDrawer();

    await waitFor(() =>
      expect(screen.getByText("Hip Hop").closest(".tag-drawer-row")).toHaveAttribute("title", "Original: Rap"),
    );
  });
});
