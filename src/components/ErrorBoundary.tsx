import { Component, type ErrorInfo, type ReactNode } from "react";
import { logger } from "../lib/logger";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Last-resort net for uncaught render errors. Without this, an error thrown during
// a view change (routing, artist identify, etc.) unmounts the whole React tree and
// leaves a blank window with no diagnostic trail, indistinguishable from a crash.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack);
    // Torn-down tree must not lose this line waiting for the periodic debounced flush.
    logger.error(`React crash: ${error.stack ?? error.message}\n${info.componentStack ?? ""}`);
    void logger.flush();
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: "1rem",
          padding: "2rem",
          textAlign: "center",
          background: "var(--bg-primary, #16161a)",
          color: "var(--text-primary, #eee)",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ maxWidth: "60ch", color: "var(--text-secondary, #999)" }}>
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          onClick={this.reset}
          style={{
            padding: "0.5rem 1.25rem",
            borderRadius: "6px",
            border: "1px solid var(--border, #444)",
            background: "var(--bg-elevated, #222)",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
