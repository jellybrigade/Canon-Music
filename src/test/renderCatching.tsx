import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * React 19 reports a render throw caught by a boundary to the root instead of rethrowing it, so
 * `.not.toThrow()` passes whether or not anything blew up. This records what the root saw.
 */
export function renderCatching(ui: ReactNode): RenderResult & { caught: unknown[] } {
  const caught: unknown[] = [];
  const result = render(ui, { onCaughtError: (error) => caught.push(error) });
  return { ...result, caught };
}
