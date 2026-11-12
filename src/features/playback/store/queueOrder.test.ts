import { describe, expect, it } from "vitest";
import type { CurrentTrack } from "./playerTypes";
import { queueInPlayOrder } from "./queueOrder";

function track(id: string): CurrentTrack {
  return { id, title: id, artist: null, duration: null };
}

const queue = [track("a"), track("b"), track("c")];

describe("queueInPlayOrder", () => {
  it("follows the queue as listed when not shuffled", () => {
    expect(queueInPlayOrder(queue, false, []).map((row) => row.track.id)).toEqual(["a", "b", "c"]);
  });

  it("follows the shuffle order when shuffled", () => {
    const rows = queueInPlayOrder(queue, true, [2, 0, 1]);
    expect(rows.map((row) => row.track.id)).toEqual(["c", "a", "b"]);
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it("ignores a stored shuffle order once shuffle is off", () => {
    expect(queueInPlayOrder(queue, false, [2, 0, 1]).map((row) => row.track.id)).toEqual(["a", "b", "c"]);
  });

  it("still lists every track once when the shuffle order is short", () => {
    expect(queueInPlayOrder(queue, true, [1]).map((row) => row.track.id)).toEqual(["b", "a", "c"]);
  });
});
