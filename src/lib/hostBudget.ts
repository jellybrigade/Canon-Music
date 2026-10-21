import { makeRateLimiter } from "./rateLimiter";

export interface HostBudget {
  /** Token bucket: spaces this host's requests one interval apart. */
  limit: () => Promise<void>;
  /** Epoch ms until which every worker must hold off this host, set on a 429. */
  cooldownUntil: number;
}

export function makeHostBudget(intervalMs: number): HostBudget {
  return { limit: makeRateLimiter(intervalMs), cooldownUntil: 0 };
}

// Re-checks after the interval wait: a 429 can start a cooldown while this request is queued.
export async function awaitHostBudget(budget: HostBudget): Promise<void> {
  for (;;) {
    const cooldown = budget.cooldownUntil - Date.now();
    if (cooldown > 0) await new Promise((r) => setTimeout(r, cooldown));
    await budget.limit();
    if (budget.cooldownUntil <= Date.now()) return;
  }
}
