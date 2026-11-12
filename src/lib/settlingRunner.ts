/**
 * Runs `run` one at a time. A request while it runs asks for one more run after it, with the
 * latest request's argument, since what the running pass already read past may have changed;
 * any number of such requests make one.
 */
export function createSettlingRunner<Argument = void>(
  run: (argument: Argument) => Promise<void>,
): (argument: Argument) => Promise<void> {
  let isRunning = false;
  let pending: { argument: Argument } | null = null;
  return async (argument) => {
    if (isRunning) {
      pending = { argument };
      return;
    }
    isRunning = true;
    let next: { argument: Argument } | null = { argument };
    try {
      while (next !== null) {
        pending = null;
        await run(next.argument);
        next = pending;
      }
    } finally {
      isRunning = false;
    }
  };
}
