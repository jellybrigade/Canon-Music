// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getDb } from "../../../db";
import { SRV } from "../../../test/navidromeFixtures";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import type { PinTarget } from "../pins";
import { PinMenuItem } from "./PinMenuItem";

const TARGET: PinTarget = { kind: "album", serverId: SRV, albumId: `${SRV}:al-1` };

let db: FakeDatabase;
let queryClient: QueryClient;

function renderItem(onDone = vi.fn()) {
  render(
    <QueryClientProvider client={queryClient}>
      <PinMenuItem target={TARGET} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

function pinnedAlbumCount(): number {
  return (db.raw.prepare("SELECT COUNT(*) AS c FROM pinned_albums").get() as { c: number }).c;
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  db.raw.exec(
    `INSERT INTO albums (id, server_id, server_type, name) VALUES ('${SRV}:al-1', '${SRV}', 'navidrome', 'First')`,
  );
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => cleanup());

describe("PinMenuItem", () => {
  it("is disabled until it knows whether the item is pinned", async () => {
    vi.mocked(getDb).mockReturnValue(new Promise(() => {}));
    renderItem();
    expect(screen.getByRole("button", { name: "Pin" }).hasAttribute("disabled")).toBe(true);
  });

  it("pins, closes the menu, and reads the pins once more", async () => {
    const onDone = renderItem();
    const button = await screen.findByRole("button", { name: "Pin" });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    const selectsBefore = db.selectCount;

    fireEvent.click(button);

    expect(onDone).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Unpin" })).toBeTruthy());
    expect(pinnedAlbumCount()).toBe(1);
    // readPins issues one select per column.
    expect(db.selectCount - selectsBefore).toBe(2);
  });

  it("unpins an item already pinned", async () => {
    db.raw.exec(`INSERT INTO pinned_albums (album_id, server_id, pinned_at) VALUES ('${SRV}:al-1', '${SRV}', 1)`);
    renderItem();

    fireEvent.click(await screen.findByRole("button", { name: "Unpin" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Pin" })).toBeTruthy());
    expect(pinnedAlbumCount()).toBe(0);
  });
});
