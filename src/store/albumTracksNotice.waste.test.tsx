// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { trackRenders } from "../test/perf";
import { useAlbumTracksNoticeStore } from "./albumTracksNotice";

beforeEach(() => {
  useAlbumTracksNoticeStore.setState({ notice: null });
});

describe("album tracks notice waste", () => {
  it("does not re-render its reader when the same failure is reported again", () => {
    const probe = trackRenders(() => useAlbumTracksNoticeStore((s) => s.notice));
    act(() => useAlbumTracksNoticeStore.getState().report("offline"));
    const afterFirst = probe.renders;

    for (let i = 0; i < 5; i++) act(() => useAlbumTracksNoticeStore.getState().report("offline"));

    expect(probe.renders).toBe(afterFirst);
    probe.unmount();
  });
});
