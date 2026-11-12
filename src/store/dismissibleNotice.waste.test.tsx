// @vitest-environment jsdom

import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { trackRenders } from "../test/perf";
import { useDismissibleNoticeStore } from "./dismissibleNotice";

beforeEach(() => {
  useDismissibleNoticeStore.setState({ notice: null });
});

describe("album tracks notice waste", () => {
  it("does not re-render its reader when the same failure is reported again", () => {
    const probe = trackRenders(() => useDismissibleNoticeStore((s) => s.notice));
    act(() => useDismissibleNoticeStore.getState().report("offline"));
    const afterFirst = probe.renders;

    for (let i = 0; i < 5; i++) act(() => useDismissibleNoticeStore.getState().report("offline"));

    expect(probe.renders).toBe(afterFirst);
    probe.unmount();
  });
});
