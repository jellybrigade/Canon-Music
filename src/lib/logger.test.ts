import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedTestDb } from "../test/sqlite";
import { formatLogValue, initLogger, logger, stopLogger } from "./logger";

const holder: { db: Awaited<ReturnType<typeof createMigratedTestDb>> | null } = { db: null };
vi.mock("../db", () => ({ getDb: async () => holder.db }));

describe("formatLogValue", () => {
  it("keeps the message when the stack carries only frames", () => {
    const err = new Error("data not found");
    err.stack = "op@tauri://localhost/assets/index.js:430:25750\nK2@tauri://localhost/assets/index.js:718:413";
    const out = formatLogValue(err);
    expect(out).toContain("Error: data not found");
    expect(out).toContain("op@tauri://localhost/assets/index.js:430:25750");
  });

  it("does not repeat a message the stack already opens with", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n    at f (file.js:1:1)";
    expect(formatLogValue(err)).toBe("Error: boom\n    at f (file.js:1:1)");
  });

  it("falls back to the message when there is no stack", () => {
    const err = new Error("no stack here");
    err.stack = undefined;
    expect(formatLogValue(err)).toBe("Error: no stack here");
  });

  it("names the error type", () => {
    const err = new TypeError("Invalid URL");
    err.stack = "@file.js:1:1";
    expect(formatLogValue(err)).toContain("TypeError: Invalid URL");
  });

  it("reports the error type when the message is empty", () => {
    const err = new Error("");
    err.stack = "@file.js:1:1";
    expect(formatLogValue(err)).toContain("Error");
  });

  it("serialises a plain object", () => {
    expect(formatLogValue({ code: 70 })).toBe('{"code":70}');
  });

  it("survives a circular object", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatLogValue(circular)).toBe("[object Object]");
  });

  it("passes a string through untouched", () => {
    expect(formatLogValue("plain")).toBe("plain");
  });
});

describe("logger writes", () => {
  const realError = console.error;

  beforeEach(async () => {
    holder.db = await createMigratedTestDb();
  });

  afterEach(() => {
    stopLogger();
    console.error = realError;
  });

  it("stores the error message a console.error was given", async () => {
    initLogger();
    const err = new Error("could not reach the server");
    err.stack = "op@tauri://localhost/assets/index.js:430:25750";
    console.error("sync: failed to fetch tracks:", err);
    await logger.flush();
    const rows = await holder.db!.select<{ message: string }[]>(
      "SELECT message FROM app_logs ORDER BY id DESC LIMIT 1",
      [],
    );
    expect(rows[0]!.message).toContain("could not reach the server");
  });

  it("keeps server credentials in a logged request URL out of the stored logs", async () => {
    initLogger();
    console.error(
      "Failed to fetch waveform:",
      "error sending request for url (https://music.example/rest/stream?u=me&t=abc123&s=salt9&v=1.16.1&id=7)",
    );
    console.error("Cover cache: 500 fetching album 1 from https://music.example/rest/getCoverArt?u=me&apiKey=k3y");
    await logger.flush();

    const text = await logger.getRecent();

    expect(text).toContain("rest/stream?u=me&t=[redacted]&s=[redacted]&v=1.16.1&id=7)");
    expect(text).toContain("getCoverArt?u=me&apiKey=[redacted]");
    expect(text).not.toMatch(/abc123|salt9|k3y/);
  });
});
