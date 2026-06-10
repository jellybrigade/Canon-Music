import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import "./FeedbackModal.css";

const WEBHOOK_URL = import.meta.env.VITE_DISCORD_WEBHOOK as string;

function detectOS(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Linux")) return "Linux";
  return "Unknown";
}

type Category = "bug" | "suggestion" | "general";

const CATEGORY_LABELS: Record<Category, string> = {
  bug: "Bug",
  suggestion: "Suggestion",
  general: "General",
};

const CATEGORY_EMOJI: Record<Category, string> = {
  bug: "🐛",
  suggestion: "💡",
  general: "💬",
};

const CATEGORY_COLOR: Record<Category, number> = {
  bug: 0xe74c3c,
  suggestion: 0x3498db,
  general: 0x2ecc71,
};

const PLACEHOLDERS: Record<Category, string> = {
  bug: "What went wrong? Any extra context is helpful.",
  suggestion: "What would you like to see?",
  general: "What's on your mind?",
};

const STEPS_PLACEHOLDER = "1. Open the app\n2. …\n3. …";

interface Props {
  serverUrl?: string;
  onClose: () => void;
}

export function FeedbackModal({ serverUrl, onClose }: Props) {
  const [category, setCategory] = useState<Category>("general");
  const [text, setText] = useState("");
  const [steps, setSteps] = useState("");
  const [stepsError, setStepsError] = useState(false);
  const [includeSysInfo, setIncludeSysInfo] = useState(true);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [appVersion, setAppVersion] = useState("…");

  useEffect(() => {
    void getVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (status === "sending") return;
    if (category === "bug") {
      if (!steps.trim()) { setStepsError(true); return; }
    } else {
      if (!text.trim()) return;
    }
    setStepsError(false);
    setStatus("sending");

    const serverHost = serverUrl
      ? (() => { try { return new URL(serverUrl).hostname; } catch { return "(unknown)"; } })()
      : "(none)";

    const sysLine = includeSysInfo
      ? `\n\n*Canon v${appVersion} · ${detectOS()} · ${serverHost}*`
      : "";

    let bodyText: string;
    if (category === "bug") {
      const parts: string[] = [];
      if (text.trim()) parts.push(`**Description**\n${text.trim()}`);
      parts.push(`**Steps to reproduce**\n${steps.trim()}`);
      bodyText = parts.join("\n\n");
    } else {
      bodyText = text.trim();
    }

    const embed = {
      title: `${CATEGORY_EMOJI[category]} ${CATEGORY_LABELS[category]}`,
      description: bodyText + sysLine,
      color: CATEGORY_COLOR[category],
      timestamp: new Date().toISOString(),
    };

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("sent");
      setTimeout(onClose, 1400);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div
      className="feedback-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="feedback-modal">
        <div className="feedback-header">
          <span className="feedback-title">Send Feedback</span>
          <button className="feedback-close" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="feedback-category-row">
          {(["bug", "suggestion", "general"] as Category[]).map((c) => (
            <button
              key={c}
              className={`feedback-cat-btn${category === c ? " feedback-cat-btn--active" : ""}`}
              onClick={() => { setCategory(c); setStepsError(false); }}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        {category === "bug" ? (
          <div className="feedback-bug-fields">
            <textarea
              className="feedback-textarea feedback-textarea--bug"
              placeholder={PLACEHOLDERS.bug}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              autoFocus
            />
            <div className="feedback-steps-label">
              Steps to reproduce <span className="feedback-required">*</span>
            </div>
            <textarea
              className={`feedback-textarea feedback-textarea--bug${stepsError ? " feedback-textarea--error" : ""}`}
              placeholder={STEPS_PLACEHOLDER}
              value={steps}
              onChange={(e) => { setSteps(e.target.value); if (e.target.value.trim()) setStepsError(false); }}
              rows={3}
            />
            {stepsError && <div className="feedback-steps-error">Steps to reproduce are required.</div>}
          </div>
        ) : (
          <textarea
            className="feedback-textarea"
            placeholder={PLACEHOLDERS[category]}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            autoFocus
          />
        )}

        <div className="feedback-footer">
          <label className="feedback-sysinfo">
            <input
              type="checkbox"
              checked={includeSysInfo}
              onChange={(e) => setIncludeSysInfo(e.target.checked)}
            />
            <span>Include system info</span>
            {includeSysInfo && (
              <span className="feedback-sysinfo-detail">v{appVersion} · {detectOS()}</span>
            )}
          </label>
          <div className="feedback-footer-right">
            {status === "error" && (
              <span className="feedback-status feedback-status--error">Send failed — try again</span>
            )}
            {status === "sent" ? (
              <span className="feedback-status feedback-status--sent">Sent! Thanks.</span>
            ) : (
              <button
                className="feedback-submit"
                onClick={() => void submit()}
                disabled={(category === "bug" ? !steps.trim() : !text.trim()) || status === "sending"}
              >
                {status === "sending" ? "Sending…" : "Send"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
