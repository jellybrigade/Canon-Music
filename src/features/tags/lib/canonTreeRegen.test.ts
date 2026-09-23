import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");
const PARSER = join(ROOT, "scripts", "parse-rym.mjs");
const TREE = join(ROOT, "src", "assets", "canon-tree.json");

function runParser(args: string[]): string {
  return execFileSync("node", [PARSER, "--stdout", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parserError(args: string[]): string {
  try {
    runParser(args);
  } catch (err) {
    if (err instanceof Error && "stderr" in err) return String(err.stderr);
    throw err;
  }
  throw new Error("parser succeeded");
}

function writeTemp(name: string, content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "canon-tree-")), name);
  writeFileSync(path, content);
  return path;
}

describe("canon tree regeneration", () => {
  it("regenerates the committed tree byte for byte, custom nodes included", () => {
    expect(runParser([])).toBe(readFileSync(TREE, "utf8"));
  });

  it("never lists a node as its own parent", () => {
    const hierarchy = writeTemp(
      "h.txt",
      "Genres\n    Punk::genre\n        Hardcore [Punk]\n            Hardcore [Punk]::genre\n            Hardcore Punk\n                Hardcore Punk::genre\n",
    );
    const custom = writeTemp("c.json", "[]");
    const tree: unknown = JSON.parse(runParser(["--input", hierarchy, "--custom", custom]));
    expect(tree).toMatchObject({ nodes: [{ id: "punk" }, { id: "hardcore-punk", parents: ["punk"] }] });
  });

  it("lists a node under every section it appears in, in one order whatever the file's", () => {
    const custom = writeTemp("c.json", "[]");
    const scenesFirst = writeTemp(
      "h.txt",
      "Scenes & Movements\n    Futurism::genre\nGenres\n    Classical Music::genre\n        Futurism::genre\nDescriptors\n    Futurism::mood\n",
    );
    const genresFirst = writeTemp(
      "h.txt",
      "Descriptors\n    Futurism::mood\nGenres\n    Classical Music::genre\n        Futurism::genre\nScenes & Movements\n    Futurism::genre\n",
    );
    const futurism = (hierarchy: string) =>
      (JSON.parse(runParser(["--input", hierarchy, "--custom", custom])) as { nodes: { id: string; sections: string[] }[] })
        .nodes.find((n) => n.id === "futurism");
    expect(futurism(scenesFirst)?.sections).toEqual(["genres", "descriptors", "scenes-and-movements"]);
    expect(futurism(genresFirst)?.sections).toEqual(["genres", "descriptors", "scenes-and-movements"]);
  });

  it("refuses a custom node whose id the hierarchy already has", () => {
    const custom = writeTemp(
      "c.json",
      JSON.stringify([{ id: "rock", name: "Rock", type: "genre", canonical_key: "rock", parents: [], sections: ["genres"] }]),
    );
    expect(parserError(["--custom", custom])).toContain('custom node "rock" already exists');
  });

  it("refuses a custom node naming a parent the tree does not have", () => {
    const custom = writeTemp(
      "c.json",
      JSON.stringify([{ id: "x-rock", name: "X Rock", type: "genre", canonical_key: "x rock", parents: ["no-such-genre"], sections: ["genres"] }]),
    );
    expect(parserError(["--custom", custom])).toContain('custom node "x-rock" names missing parent "no-such-genre"');
  });
});
