export function sleepTimerCountdown(endsAt: number, now: number): string {
  const ms = Math.max(0, endsAt - now);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
