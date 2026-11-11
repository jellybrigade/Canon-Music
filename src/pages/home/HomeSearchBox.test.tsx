// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { HomeSearchBox } from "./HomeSearchBox";

function Harness({ initial, onOpenCommandPalette = vi.fn() }: { initial: string; onOpenCommandPalette?: () => void }) {
  const [value, setValue] = useState(initial);
  return <HomeSearchBox value={value} onChange={setValue} onOpenCommandPalette={onOpenCommandPalette} />;
}

function input() {
  return screen.getByPlaceholderText<HTMLInputElement>("Search…");
}

describe("HomeSearchBox", () => {
  it("clears the query on Escape and keeps focus for a new one", () => {
    render(<Harness initial="joni" />);
    input().focus();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input().value).toBe("");
    expect(document.activeElement).toBe(input());
  });

  it("leaves the box on Escape once it is empty", () => {
    render(<Harness initial="" />);
    input().focus();
    expect(document.activeElement).toBe(input());
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(document.activeElement).not.toBe(input());
  });

  it("leaves other keys to the input", () => {
    render(<Harness initial="joni" />);
    input().focus();
    fireEvent.keyDown(input(), { key: "a" });
    expect(input().value).toBe("joni");
    expect(document.activeElement).toBe(input());
  });

  it("clears from the clear button", () => {
    render(<Harness initial="joni" />);
    fireEvent.click(screen.getByTitle("Clear"));
    expect(input().value).toBe("");
  });
});
