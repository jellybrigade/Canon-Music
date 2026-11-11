import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { deleteTagMapping, lockTagMapping, saveTagMapping, setRapToHipHop, TAG_VOCAB_SQL } from "./useTagMappings";

let db: FakeDatabase;

beforeEach(async () => {
  db = await createMigratedTestDb();
  db.raw.prepare("DELETE FROM tag_mappings").run();
  vi.mocked(getDb).mockResolvedValue(db as never);
});

function mapping(rawValue: string, canonicalId: string, options: { norm: string; locked?: number }) {
  db.raw
    .prepare(
      "INSERT INTO tag_mappings (raw_value, kind, canonical_id, source, locked, norm_value) VALUES (?, 'genre', ?, 'manual', ?, ?)",
    )
    .run(rawValue, canonicalId, options.locked ?? 0, options.norm);
}

function rows() {
  return db.raw.prepare("SELECT raw_value, canonical_id, locked FROM tag_mappings ORDER BY raw_value").all() as {
    raw_value: string;
    canonical_id: string;
    locked: number;
  }[];
}

describe("tag mapping writes act on the whole spelling group", () => {
  it("refuses to save a spelling whose sibling spelling is locked", async () => {
    mapping("hip hop", "hip-hop", { norm: "hip hop", locked: 1 });

    await expect(saveTagMapping({ rawValue: "Hip-Hop", kind: "genre", canonicalId: "rap" })).rejects.toThrow(/locked/);
    expect(rows()).toEqual([{ raw_value: "hip hop", canonical_id: "hip-hop", locked: 1 }]);
  });

  it("locks and unlocks every spelling of the group", async () => {
    mapping("Hip-Hop", "hip-hop", { norm: "hip hop" });
    mapping("HIP_HOP", "hip-hop", { norm: "hip hop" });
    mapping("Rock", "rock", { norm: "rock" });

    await lockTagMapping({ rawValue: "hip hop", kind: "genre", locked: true });
    expect(rows().map((r) => [r.raw_value, r.locked])).toEqual([
      ["HIP_HOP", 1],
      ["Hip-Hop", 1],
      ["Rock", 0],
    ]);

    await lockTagMapping({ rawValue: "Hip-Hop", kind: "genre", locked: false });
    expect(rows().every((r) => r.locked === 0)).toBe(true);
  });

  it("replaces the decision of every spelling, so the saved one is what the group shows and applies", async () => {
    db.raw
      .prepare(
        "INSERT INTO tag_vocab_cache (norm_value, raw_value, kind, album_count) VALUES ('hip hop', 'Hip-Hop', 'genre', 2)",
      )
      .run();
    db.raw
      .prepare(
        "INSERT INTO track_tags (track_id, kind, raw_value, source, canonical_id) VALUES ('t1', 'genre', 'HIP_HOP', 'server', 'rap')",
      )
      .run();
    mapping("HIP_HOP", "rap", { norm: "hip hop" });

    await saveTagMapping({ rawValue: "Hip-Hop", kind: "genre", canonicalId: "hip-hop" });

    expect(rows()).toEqual([{ raw_value: "Hip-Hop", canonical_id: "hip-hop", locked: 0 }]);
    const vocab = await db.select<{ canonical_id: string }[]>(TAG_VOCAB_SQL);
    expect(vocab).toEqual([expect.objectContaining({ canonical_id: "hip-hop" })]);
    expect(db.raw.prepare("SELECT canonical_id FROM track_tags").pluck().get()).toBe("hip-hop");
  });

  it("leaves other groups alone when saving and deleting", async () => {
    mapping("Rock", "rock", { norm: "rock" });

    await saveTagMapping({ rawValue: "Jazz", kind: "genre", canonicalId: "jazz" });
    await deleteTagMapping({ rawValue: "jazz", kind: "genre" });

    expect(rows()).toEqual([{ raw_value: "Rock", canonical_id: "rock", locked: 0 }]);
  });
});

describe("the Rap to Hip Hop rule", () => {
  function tagTrack(rawValue: string) {
    db.raw
      .prepare("INSERT INTO track_tags (track_id, kind, raw_value, source) VALUES ('t1', 'genre', ?, 'server')")
      .run(rawValue);
  }

  it("leaves a locked or manual decision for any spelling of Rap alone", async () => {
    tagTrack("RAP");
    mapping("rap", "trap", { norm: "rap", locked: 1 });

    await setRapToHipHop(true);
    expect(rows()).toEqual([{ raw_value: "rap", canonical_id: "trap", locked: 1 }]);

    await setRapToHipHop(false);
    expect(rows()).toEqual([{ raw_value: "rap", canonical_id: "trap", locked: 1 }]);
  });

  it("maps every spelling of Rap while on, and clears it when turned off", async () => {
    tagTrack("RAP");

    await setRapToHipHop(true);
    expect(db.raw.prepare("SELECT canonical_id FROM track_tags").pluck().get()).toBe("hip-hop");

    await setRapToHipHop(false);
    expect(rows()).toEqual([]);
    expect(db.raw.prepare("SELECT canonical_id FROM track_tags").pluck().get()).toBeNull();
  });
});
