import { describe, expect, it } from "vitest";
import { crashReportText } from "./crashReport";

describe("crashReportText", () => {
  it("keeps server credentials quoted in the panic out of the report", () => {
    const text = crashReportText("[unix:1] panicked at src/stream.rs: https://m.example/rest/stream?u=me&t=abc&s=def");

    expect(text).toContain("u=me&t=[redacted]&s=[redacted]");
    expect(text).not.toContain("abc");
  });

  it("does not claim the app crashed, since most panics leave it running", () => {
    expect(crashReportText("boom")).not.toMatch(/crashed/i);
  });
});
