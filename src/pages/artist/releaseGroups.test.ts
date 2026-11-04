import { describe, expect, it } from "vitest";
import type { AlbumRow } from "../../types/library";
import { groupAlbums } from "./releaseGroups";

function album(name: string, releaseType: string | null = null): AlbumRow {
  return { id: name, server_id: "s1", name, artist: "X", year: null, artwork_url: null, release_type: releaseType };
}

function groupOf(name: string, releaseType: string | null = null): string | undefined {
  return groupAlbums([album(name, releaseType)])[0]?.group;
}

describe("groupAlbums", () => {
  it("trusts the stored release type over the title", () => {
    expect(groupOf("Greatest Hits", "album")).toBe("album");
    expect(groupOf("Song", "Single")).toBe("single");
    expect(groupOf("Live at Leeds", "live")).toBe("compilation");
  });

  it("reads a release marker at the end of an untyped title", () => {
    expect(groupOf("Hello - Single")).toBe("single");
    expect(groupOf("Hello (Single)")).toBe("single");
    expect(groupOf("Four Songs EP")).toBe("ep");
    expect(groupOf("Four Songs - EP")).toBe("ep");
    expect(groupOf("Four Songs [EP]")).toBe("ep");
  });

  it("files untyped best-of and box set releases as compilations", () => {
    expect(groupOf("The Best of Blondie")).toBe("compilation");
    expect(groupOf("Greatest Hits Vol. 2")).toBe("compilation");
    expect(groupOf("Anthology 1")).toBe("compilation");
    expect(groupOf("Complete Recordings Box Set")).toBe("compilation");
  });

  it("keeps an album whose title only contains a marker word as an album", () => {
    expect(groupOf("Single Mothers")).toBe("album");
    expect(groupOf("The Single Life Revisited")).toBe("album");
    expect(groupOf("Ep and Friends")).toBe("album");
    expect(groupOf("Best of Both Worlds")).toBe("album");
    expect(groupOf("A Compilation of Dreams")).toBe("album");
  });

  it("lists groups in a fixed order and drops empty ones", () => {
    const groups = groupAlbums([album("B - Single"), album("A")]);
    expect(groups.map((g) => g.group)).toEqual(["album", "single"]);
  });
});
