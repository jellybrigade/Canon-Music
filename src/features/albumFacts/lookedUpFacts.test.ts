import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import { readLookedUpFacts } from "./lookedUpFacts";

let db: FakeDatabase;

beforeEach(async () => {
  db = await createMigratedTestDb();
  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist, year)
       VALUES ('a1', 's', 'navidrome', 'you made me / skin on linen', 'PISS', 2026)`,
    )
    .run();
});

function lookup(row: { source?: string; label: string | null; status?: string; name?: string; serverId?: string }) {
  db.raw
    .prepare(
      `INSERT INTO album_release_lookups
         (album_id, server_id, source, release_date, label, looked_up_name, looked_up_artist, looked_up_year,
          status, checked_at)
       VALUES ('a1', ?, ?, '2026-10-30', ?, ?, 'PISS', 2026, ?, 0)`,
    )
    .run(
      row.serverId ?? "s",
      row.source ?? "deezer",
      row.label,
      row.name ?? "you made me / skin on linen",
      row.status ?? "found",
    );
}

describe("readLookedUpFacts: Deezer label", () => {
  it("reads the label a source found for the album", async () => {
    lookup({ label: "Sub Pop Records" });
    expect(await readLookedUpFacts(db, { albumId: "a1", serverId: "s" })).toEqual({
      label: "Sub Pop Records",
      catalogNumber: null,
      country: null,
    });
  });

  it("is null when no source found a label", async () => {
    lookup({ label: null });
    lookup({ source: "itunes", label: null });
    expect((await readLookedUpFacts(db, { albumId: "a1", serverId: "s" })).label).toBeNull();
  });

  it("ignores a lookup made under another album name", async () => {
    lookup({ label: "Sub Pop Records", name: "old title" });
    expect((await readLookedUpFacts(db, { albumId: "a1", serverId: "s" })).label).toBeNull();
  });

  it("ignores a lookup that did not find the album", async () => {
    lookup({ label: "Sub Pop Records", status: "none" });
    expect((await readLookedUpFacts(db, { albumId: "a1", serverId: "s" })).label).toBeNull();
  });

  it("ignores another server's lookup", async () => {
    lookup({ label: "Sub Pop Records", serverId: "other" });
    expect((await readLookedUpFacts(db, { albumId: "a1", serverId: "s" })).label).toBeNull();
  });
});

function discogs(row: {
  label: string | null;
  catalogNumber?: string | null;
  country?: string | null;
  status?: string;
}) {
  db.raw
    .prepare(
      `INSERT INTO album_discogs
         (album_id, server_id, discogs_release_id, label, catalog_number, country,
          looked_up_name, looked_up_artist, looked_up_year, status, checked_at)
       VALUES ('a1', 's', 1, ?, ?, ?, 'you made me / skin on linen', 'PISS', 2026, ?, 0)`,
    )
    .run(row.label, row.catalogNumber ?? null, row.country ?? null, row.status ?? "found");
}

describe("readLookedUpFacts: Discogs", () => {
  it("reads Discogs' label, catalog number and country", async () => {
    discogs({ label: "Paper Bag Records", catalogNumber: "PAPER166CD", country: "Canada" });
    expect(await readLookedUpFacts(db, { albumId: "a1", serverId: "s" })).toEqual({
      label: "Paper Bag Records",
      catalogNumber: "PAPER166CD",
      country: "Canada",
    });
  });

  it("prefers Discogs' label over Deezer's", async () => {
    lookup({ label: "Sub Pop Records" });
    discogs({ label: "Paper Bag Records" });
    expect((await readLookedUpFacts(db, { albumId: "a1", serverId: "s" })).label).toBe("Paper Bag Records");
  });

  it("drops Discogs' catalog number beside Deezer's label, which it doesn't belong to", async () => {
    lookup({ label: "Sub Pop Records" });
    discogs({ label: null, catalogNumber: "PAPER166CD", country: "Canada" });
    expect(await readLookedUpFacts(db, { albumId: "a1", serverId: "s" })).toEqual({
      label: "Sub Pop Records",
      catalogNumber: null,
      country: "Canada",
    });
  });

  it("ignores a Discogs lookup that did not find the album", async () => {
    discogs({ label: "Paper Bag Records", country: "Canada", status: "none" });
    expect(await readLookedUpFacts(db, { albumId: "a1", serverId: "s" })).toEqual({
      label: null,
      catalogNumber: null,
      country: null,
    });
  });
});
