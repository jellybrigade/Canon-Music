import { describe, expect, it } from "vitest";
import { sortRows } from "./trackSort";

const rows = (...values: (string | number | null)[]) => values.map((value, index) => ({ index, value }));
const valueFor = (row: { value: string | number | null }) => row.value;

describe("sortRows", () => {
  it("orders strings ignoring case and accents", () => {
    expect(sortRows(rows("b", "Á", "c"), valueFor, "asc").map((r) => r.value)).toEqual(["Á", "b", "c"]);
  });

  it("orders numbers both ways", () => {
    expect(sortRows(rows(3, 1, 2), valueFor, "asc").map((r) => r.value)).toEqual([1, 2, 3]);
    expect(sortRows(rows(3, 1, 2), valueFor, "desc").map((r) => r.value)).toEqual([3, 2, 1]);
  });

  it("puts missing values last in either direction", () => {
    expect(sortRows(rows(null, 2, 1), valueFor, "asc").map((r) => r.value)).toEqual([1, 2, null]);
    expect(sortRows(rows(null, 2, 1), valueFor, "desc").map((r) => r.value)).toEqual([2, 1, null]);
  });

  it("keeps the original order between equal values", () => {
    expect(sortRows(rows("a", "b", "a"), valueFor, "desc").map((r) => r.index)).toEqual([1, 0, 2]);
  });

  it("leaves the input untouched", () => {
    const input = rows(2, 1);
    sortRows(input, valueFor, "asc");
    expect(input.map((r) => r.value)).toEqual([2, 1]);
  });
});
