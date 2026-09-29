/**
 * Waste probes: render churn (`trackRenders`), over-fetching (`invokeCount`, `queryLog`).
 * Always assert an exact count; `toHaveBeenCalled()` passes on 1 call and on 500.
 */
import { render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { invoke } from "./mocks/tauri";

export interface RenderProbe<T> {
  /** How many times the probed hook has run since mount. Mount itself counts as 1. */
  readonly renders: number;
  /** Value returned by the most recent run. */
  readonly value: T;
  unmount(): void;
}

/**
 * Mounts `hook` in a throwaway component and counts renders of the probe. Not wrapped in
 * StrictMode, so counts compare exactly.
 */
export function trackRenders<T>(hook: () => T, wrapper?: (children: ReactElement) => ReactElement): RenderProbe<T> {
  const probe = { renders: 0, value: undefined as T, unmount: () => {} };

  function Probe() {
    probe.renders++;
    probe.value = hook();
    return null;
  }

  const element = createElement(Probe);
  const { unmount } = render(wrapper ? wrapper(element) : element);
  probe.unmount = unmount;
  return probe as RenderProbe<T>;
}

/** Calls recorded by the mocked Tauri `invoke`, optionally for one command. Pair with `resetTauriMocks()` in `beforeEach`. */
export function invokeCount(cmd?: string): number {
  const calls = invoke.mock.calls as unknown as [string, unknown?][];
  return cmd === undefined ? calls.length : calls.filter(([c]) => c === cmd).length;
}

/** Args of every recorded `invoke` for one command, in order. Useful for "same id twice". */
export function invokeArgs(cmd: string): unknown[] {
  const calls = invoke.mock.calls as unknown as [string, unknown?][];
  return calls.filter(([c]) => c === cmd).map(([, args]) => args);
}
