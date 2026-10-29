import { redactCredentials } from "./redactCredentials";

// A panic off the main thread leaves Canon running, so the report can't say it crashed.
export function crashReportText(report: string): string {
  return `Canon hit an internal error last session:\n\n${redactCredentials(report)}`;
}
