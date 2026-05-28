export function cx(...args: (string | undefined | false | null)[]): string {
  return args.filter(Boolean).join(" ");
}
