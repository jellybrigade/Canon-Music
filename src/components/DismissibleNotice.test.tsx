// @vitest-environment jsdom

import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDismissibleNoticeStore } from "../store/dismissibleNotice";
import { DismissibleNotice } from "./DismissibleNotice";

beforeEach(() => {
  useDismissibleNoticeStore.setState({ notice: null });
});

describe("DismissibleNotice", () => {
  it("renders nothing while there is nothing to report", () => {
    const { container } = render(<DismissibleNotice />);
    expect(container.firstChild).toBeNull();
  });

  it("shows why an album click played nothing", () => {
    const { container } = render(<DismissibleNotice />);
    act(() => useDismissibleNoticeStore.getState().report("Couldn't get the tracks for Blue Train: offline"));
    expect(container.querySelector(".normalizing-bar")?.textContent).toContain(
      "Couldn't get the tracks for Blue Train: offline",
    );
  });

  it("goes away when dismissed", () => {
    useDismissibleNoticeStore.getState().report("The server lists no tracks for Blue Train");
    const { container } = render(<DismissibleNotice />);
    const dismiss = container.querySelector<HTMLButtonElement>(".normalizing-bar__dismiss");
    if (!dismiss) throw new Error("dismiss button missing");
    fireEvent.click(dismiss);
    expect(container.firstChild).toBeNull();
  });
});
