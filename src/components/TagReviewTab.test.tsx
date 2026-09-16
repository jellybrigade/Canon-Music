// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TagReviewTab } from "./TagReviewTab";
import type { TagVocabRow } from "../hooks/useTagMappings";

const vocab: TagVocabRow[] = [
  { raw_value: "Techno", kind: "genre", album_count: 2, sources: "file,lastfm", canonical_id: null, mapping_source: null, locked: 0 },
  { raw_value: "Rave", kind: "genre", album_count: 1, sources: null, canonical_id: null, mapping_source: null, locked: 0 },
];

const albumsByTag: Record<string, { album_id: string; album_name: string; artwork_url: string | null }[]> = {
  Techno: [
    { album_id: "srv:a1", album_name: "One", artwork_url: "al-1" },
    { album_id: "srv:a2", album_name: "Two", artwork_url: "al-2" },
  ],
  Rave: [{ album_id: "srv:a3", album_name: "Three", artwork_url: null }],
};

vi.mock("../hooks/useTagMappings", () => ({
  useTagVocab: () => ({ data: vocab, isLoading: false, isError: false, error: null }),
  useTagMappings: () => ({ saveMapping: { mutate: vi.fn() } }),
  useTagAlbums: (rawValue: string) => ({ data: albumsByTag[rawValue] }),
}));
vi.mock("../hooks/useMeasuredElement", () => ({
  useMeasuredElement: () => ({ attach: () => {}, height: 0 }),
}));
vi.mock("../hooks/useServer", () => ({
  useServers: () => ({ data: [{ id: "srv" }] }),
  useServerWithCredential: () => ({
    data: { server: { url: "http://nd", username: "u" }, credential: "c" },
  }),
}));

afterEach(cleanup);

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TagReviewTab treeNodes={[]} autoNote={null} onDismissAutoNote={() => {}} onCreateNode={() => {}} />
    </QueryClientProvider>,
  );
}

function gridCells(row: Element): string[] {
  const info = row.querySelector(".rr-info");
  const infoCells = info ? Array.from(info.children) : [];
  const actions = Array.from(row.children).filter((child) => child !== info);
  return [...infoCells, ...actions].map((cell) => cell.className);
}

describe("TagReviewTab", () => {
  it("renders a coverless one-album row with the same columns as a multi-album row", () => {
    renderTab();

    const rows = Array.from(document.querySelectorAll(".review-row"));
    expect(rows).toHaveLength(2);
    const [techno, rave] = rows;

    expect(techno!.querySelectorAll(".tags-art-thumb")).toHaveLength(2);
    expect(rave!.querySelectorAll(".tags-art-thumb")).toHaveLength(0);
    expect(gridCells(rave!)).toEqual(gridCells(techno!));
    expect(gridCells(techno!)).toHaveLength(5);
  });
});
