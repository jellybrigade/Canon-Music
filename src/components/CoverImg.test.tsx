// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { initCoverServer, replaceCoverRevisions, setCoverRevision } from "../clients/navidromeUrls";
import { CoverImg } from "./CoverImg";

afterEach(() => {
  replaceCoverRevisions(new Map());
});

describe("CoverImg", () => {
  it("shows a cover chosen after its URL was stored, and the server's again once cleared", () => {
    initCoverServer();
    const stored = "cover://localhost/cover/al-abc_ff?size=64";
    const { container } = render(<CoverImg src={stored} alt="" />);
    const image = () => container.querySelector("img")?.getAttribute("src");
    expect(image()).toBe(stored);

    act(() => setCoverRevision("abc", 1700));
    expect(image()).toBe(`${stored}&v=1700`);

    act(() => setCoverRevision("abc", null));
    expect(image()).toBe(stored);
  });
});
