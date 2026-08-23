/**
 * Waste probes: helpers for asserting that something happens *once*, or not at all.
 *
 * Correctness tests answer "is the output right". These answer the other half of "done":
 * how many renders, how many round trips, how much work per unit of time. Both are cheap
 * to assert and neither is caught by a green correctness suite - an app that fetches the
 * same album four times, or re-renders the whole player five times a second, passes every
 * assertion in this repo today.
 *
 * The three classes worth probing, and the tool for each:
 *
 * - Render churn (a subscriber waking for state it does not read) -> `trackRenders`.
 * - Over-fetching (N calls where 1 was needed, or a call per keystroke) -> `invokeCount`,
 *   or `FakeDatabase.selectCount` / `queryLog` from `./sqlite`.
 * - Repeated work over time (a duplicated interval, a self-retriggering effect) -> run the
 *   clock forward a fixed span with fake timers and assert the count matches the rate, not
 *   just "greater than zero".
 *
 * Always assert an exact count. `toHaveBeenCalled()` passes on 1 call and on 500.
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
 * Mounts `hook` in a throwaway component and counts its runs.
 *
 * Counts *renders of the probe*, which is what a subscriber costs the app - not commits,
 * not effect runs. A hook that reads one atomic slice of a store should render once at
 * mount and once per change to that slice, and never for a change to any other slice.
 *
 * React StrictMode double-invokes render, so the probe deliberately does not wrap in it:
 * the number here is meant to be compared against an exact expected count.
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

/**
 * Calls recorded by the mocked Tauri `invoke`, optionally for one command.
 *
 * Pair with `resetTauriMocks()` in `beforeEach` (which clears the call log) so a count is
 * always scoped to the test that reads it.
 */
export function invokeCount(cmd?: string): number {
  const calls = invoke.mock.calls as unknown as [string, unknown?][];
  return cmd === undefined ? calls.length : calls.filter(([c]) => c === cmd).length;
}

/** Args of every recorded `invoke` for one command, in order. Useful for "same id twice". */
export function invokeArgs(cmd: string): unknown[] {
  const calls = invoke.mock.calls as unknown as [string, unknown?][];
  return calls.filter(([c]) => c === cmd).map(([, args]) => args);
}
