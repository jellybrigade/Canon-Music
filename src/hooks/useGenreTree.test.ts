import { describe, expect, it } from "vitest";
import { sectionRoots } from "./useGenreTree";
import type { NodeSection, TreeNode } from "../lib/canonicalize";

function node(id: string, parents: string[], ...sections: NodeSection[]): TreeNode {
  return { id, name: id, type: "genre", canonical_key: id, parents, sections };
}

describe("sectionRoots", () => {
  it("roots a node under every section it is listed in", () => {
    const nodes = [node("choral", [], "genres", "descriptors"), node("rock", [], "genres")];
    expect(sectionRoots(nodes)).toEqual({
      genres: ["choral", "rock"],
      descriptors: ["choral"],
      "scenes-and-movements": [],
    });
  });

  it("roots a node whose parents have no albums", () => {
    const nodes = [node("art-rock", ["rock"], "genres")];
    expect(sectionRoots(nodes).genres).toEqual(["art-rock"]);
  });

  it("does not root a node with a live parent", () => {
    const nodes = [node("rock", [], "genres"), node("art-rock", ["rock"], "genres")];
    expect(sectionRoots(nodes).genres).toEqual(["rock"]);
  });

  it("roots a node in a section where none of its live parents is listed", () => {
    const nodes = [node("classical-music", [], "genres"), node("futurism", ["classical-music"], "genres", "scenes-and-movements")];
    expect(sectionRoots(nodes)).toEqual({
      genres: ["classical-music"],
      descriptors: [],
      "scenes-and-movements": ["futurism"],
    });
  });

  it("orders roots by name, ignoring case", () => {
    const nodes = [node("b", [], "genres"), { ...node("a", [], "genres"), name: "A" }, node("c", [], "genres")];
    expect(sectionRoots(nodes).genres).toEqual(["a", "b", "c"]);
  });
});
