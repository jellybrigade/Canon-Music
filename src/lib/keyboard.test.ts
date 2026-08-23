// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { isTextEntryTarget } from "./keyboard";

function keydownOn(el: EventTarget | null): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: "k" });
  Object.defineProperty(e, "target", { value: el, configurable: true });
  return e;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("isTextEntryTarget", () => {
  it("is true for a text input", () => {
    const el = document.createElement("input");
    document.body.appendChild(el);
    expect(isTextEntryTarget(keydownOn(el))).toBe(true);
  });

  it("is true for a textarea", () => {
    const el = document.createElement("textarea");
    document.body.appendChild(el);
    expect(isTextEntryTarget(keydownOn(el))).toBe(true);
  });

  it("is true for a select, where typing jumps to an option", () => {
    const el = document.createElement("select");
    document.body.appendChild(el);
    expect(isTextEntryTarget(keydownOn(el))).toBe(true);
  });

  it("is true for a contenteditable element", () => {
    const el = document.createElement("div");
    // jsdom does not implement `isContentEditable` from the attribute.
    Object.defineProperty(el, "isContentEditable", { value: true });
    document.body.appendChild(el);
    expect(isTextEntryTarget(keydownOn(el))).toBe(true);
  });

  it("is false for an ordinary element and for a button", () => {
    const div = document.createElement("div");
    const button = document.createElement("button");
    document.body.append(div, button);
    expect(isTextEntryTarget(keydownOn(div))).toBe(false);
    expect(isTextEntryTarget(keydownOn(button))).toBe(false);
  });

  it("is false when the event has no target at all", () => {
    // A synthetic or already-dispatched event can report a null target, and a global
    // shortcut asking the question must not throw on it.
    expect(isTextEntryTarget(keydownOn(null))).toBe(false);
  });
});
