import { describe, expect, it } from "vitest";
import { rankCommands } from "./commandMatch";

const commands = ["Home", "Settings", "Sleep timer: 30 minutes", "Resync library", "Library", "Shuffle library"].map(
  (label) => ({ label }),
);
const labels = (query: string) => rankCommands(commands, query).map((c) => c.label);

describe("rankCommands", () => {
  it("puts a label the query starts ahead of one it only appears in", () => {
    expect(labels("lib")).toEqual(["Library", "Resync library", "Shuffle library"]);
  });

  it("matches a prefix whatever the case", () => {
    expect(labels("sett")).toEqual(["Settings"]);
    expect(labels("SETT")).toEqual(["Settings"]);
  });

  it("ranks a word start above a match inside a word", () => {
    expect(labels("ti")).toEqual(["Sleep timer: 30 minutes", "Settings"]);
  });

  it("drops commands the query is not in, and returns nothing for a blank query", () => {
    expect(labels("zebra")).toEqual([]);
    expect(labels("  ")).toEqual([]);
  });
});
