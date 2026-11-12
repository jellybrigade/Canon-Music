// Guard for known-issues.md: "A base rule that removes the outline must put a focus ring back."
// base.css sets `outline: none` on every button, so without a global `:focus-visible` replacement
// tabbing through the notice banner, search results or any button without its own rule showed nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BASE_CSS = readFileSync(fileURLToPath(new URL("../styles/base.css", import.meta.url)), "utf-8");

function focusRingSelectors(css: string): string[] {
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  return rules
    .filter(([, , body]) => /outline:\s*(?!none\b|0\b)\S[^;]*;/.test(body ?? ""))
    .flatMap(([, selectors]) => (selectors ?? "").split(",").map((selector) => selector.trim()));
}

describe("focus ring guard", () => {
  it("gives every button, link and role=button a visible keyboard focus ring", () => {
    const selectors = focusRingSelectors(BASE_CSS);
    for (const required of ["button:focus-visible", "a:focus-visible", '[role="button"]:focus-visible']) {
      expect(selectors).toContain(required);
    }
  });

  it("detects a missing ring", () => {
    expect(focusRingSelectors("button:focus-visible { outline: none; }")).not.toContain("button:focus-visible");
  });
});
