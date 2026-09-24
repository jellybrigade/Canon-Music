// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { onInvoke, resetTauriMocks } from "../../../test/mocks/tauri";
import { invokeArgs, invokeCount } from "../../../test/perf";

vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);

const holder: { db: FakeDatabase | null } = { db: null };
vi.mock("../../../db", () => ({ getDb: async () => holder.db }));

const { DanglingGenresPanel } = await import("./DanglingGenresPanel");
const { bustCanonTreeCache } = await import("../lib/canonicalize");

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DanglingGenresPanel treeNodes={[]} />
      <span className="probe">mounted</span>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  resetTauriMocks();
  bustCanonTreeCache();
  holder.db = await createMigratedTestDb();
  onInvoke("repair_dangling_genre_id", () => undefined);
});

async function seedDangling(): Promise<void> {
  await holder.db?.execute(
    "INSERT INTO album_user_genres (album_id, canonical_id, name) VALUES ('a1', 'gone', 'Gone Genre'), ('a2', 'gone', 'Gone Genre')"
  );
}

describe("DanglingGenresPanel", () => {
  it("lists a genre the tree no longer has, with where it is used", async () => {
    await seedDangling();
    renderPanel();
    expect(await screen.findByText("Gone Genre")).not.toBeNull();
    expect(document.querySelector(".rd-uses")?.textContent).toBe("2 genres you added");
  });

  it("removes it everywhere with one repair call", async () => {
    await seedDangling();
    renderPanel();
    fireEvent.click(await screen.findByText("Remove"));
    await waitFor(() => expect(invokeCount("repair_dangling_genre_id")).toBe(1));
    expect(invokeArgs("repair_dangling_genre_id")).toEqual([{ from: "gone", to: null }]);
  });

  it("renders nothing when every stored genre is in the tree", async () => {
    renderPanel();
    await waitFor(() => expect(holder.db?.queryLog.some((q) => q.sql.includes("playlists"))).toBe(true));
    expect(document.querySelector(".review-dangling")).toBeNull();
    expect(document.querySelector(".probe")).not.toBeNull();
  });
});
