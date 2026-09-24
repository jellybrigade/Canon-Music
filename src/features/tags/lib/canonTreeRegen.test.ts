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

const NO_RENAMES = writeTemp("r.json", "[]");

type Rename = { from: string; fromName: string; to: string };
type ParsedTree = { version: string; renames: Rename[]; nodes: { id: string }[] };

const SMALL_HIERARCHY = "Genres\n    Rock::genre\n        Punk Rock::genre\n    Psychedelic::genre\n";

function parseSmall(renames: Rename[], hierarchy = SMALL_HIERARCHY): ParsedTree {
  const args = [
    "--input", writeTemp("h.txt", hierarchy),
    "--custom", writeTemp("c.json", "[]"),
    "--renames", writeTemp("r.json", JSON.stringify(renames)),
  ];
  return JSON.parse(runParser(args)) as ParsedTree;
}

function renameError(renames: Rename[]): string {
  return parserError([
    "--input", writeTemp("h.txt", SMALL_HIERARCHY),
    "--custom", writeTemp("c.json", "[]"),
    "--renames", writeTemp("r.json", JSON.stringify(renames)),
  ]);
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
    const tree: unknown = JSON.parse(runParser(["--input", hierarchy, "--custom", custom, "--renames", NO_RENAMES]));
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
      (JSON.parse(runParser(["--input", hierarchy, "--custom", custom, "--renames", NO_RENAMES])) as { nodes: { id: string; sections: string[] }[] })
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

describe("canon tree renames", () => {
  it("writes the rename history beside the nodes", () => {
    const tree = parseSmall([{ from: "pyschedelic", fromName: "Pyschedelic", to: "psychedelic" }]);
    expect(tree.renames).toEqual([{ from: "pyschedelic", fromName: "Pyschedelic", to: "psychedelic" }]);
    expect(tree.nodes.map((n) => n.id)).toEqual(["rock", "punk-rock", "psychedelic"]);
  });

  it("resolves a chain of renames to the id the tree holds now", () => {
    const tree = parseSmall([
      { from: "punk", fromName: "Punk", to: "punk-and-hardcore" },
      { from: "punk-and-hardcore", fromName: "Punk & Hardcore", to: "punk-rock" },
    ]);
    expect(tree.renames).toEqual([
      { from: "punk", fromName: "Punk", to: "punk-rock" },
      { from: "punk-and-hardcore", fromName: "Punk & Hardcore", to: "punk-rock" },
    ]);
  });

  it("refuses a rename onto an id the tree does not have", () => {
    expect(renameError([{ from: "punk", fromName: "Punk", to: "hardcore" }])).toMatch(/"hardcore" is not in the tree/);
  });

  it("refuses a rename away from an id the tree still has", () => {
    expect(renameError([{ from: "rock", fromName: "Rock", to: "psychedelic" }])).toMatch(/"rock" is still in the tree/);
  });

  it("refuses a cycle", () => {
    expect(
      renameError([
        { from: "a", fromName: "A", to: "b" },
        { from: "b", fromName: "B", to: "a" },
      ]),
    ).toMatch(/cycle/);
  });

  it("refuses the same id renamed twice", () => {
    expect(
      renameError([
        { from: "punk", fromName: "Punk", to: "rock" },
        { from: "punk", fromName: "Punk", to: "punk-rock" },
      ]),
    ).toMatch(/"punk" is renamed twice/);
  });
});

describe("canon tree version", () => {
  it("is stable for the same input", () => {
    const first = parseSmall([]).version;
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(parseSmall([]).version).toBe(first);
  });

  it("moves when a node or a rename changes", () => {
    const versions = new Set([
      parseSmall([]).version,
      parseSmall([{ from: "pyschedelic", fromName: "Pyschedelic", to: "psychedelic" }]).version,
      parseSmall([], SMALL_HIERARCHY + "    Jazz::genre\n").version,
    ]);
    expect(versions.size).toBe(3);
  });
});
