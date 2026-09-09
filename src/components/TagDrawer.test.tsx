// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TagDrawer } from "./TagDrawer";
import { __resetModalRegistry, useAnyModalOpen } from "../hooks/useModalChrome";

vi.mock("../db", () => ({ getDb: () => Promise.resolve({ select: () => Promise.resolve([]) }) }));
vi.mock("../lib/canonicalize", () => ({ getCanonTree: () => Promise.resolve({ nodes: [] }) }));
vi.mock("../hooks/useNormalizeAlbum", () => ({
  useNormalizeAlbum: () => ({
    data: { genres: [], descriptors: [], scenes: [], unresolved: [] },
    isLoading: false,
  }),
}));
vi.mock("../hooks/useAlbumIdentity", () => ({ useAlbumIdentity: () => ({ data: null }) }));
vi.mock("../hooks/useTagMappings", () => ({
  useTagMappings: () => ({ saveMapping: vi.fn(), data: new Map() }),
}));

beforeEach(() => __resetModalRegistry());
afterEach(cleanup);

function Probe() {
  return <span data-testid="any-modal">{String(useAnyModalOpen())}</span>;
}

function renderDrawer(onClose = vi.fn(), extra?: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      {extra}
      <TagDrawer albumId="srv:alb1" albumArtist="Artist" albumName="Album" onClose={onClose} />
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
});
