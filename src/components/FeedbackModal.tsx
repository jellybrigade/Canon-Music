import { getVersion } from "@tauri-apps/api/app";
import { X } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { boundedFetch, UPLOAD_TIMEOUT_MS } from "../clients/boundedFetch";
import { logger } from "../lib/logger";
import { useModalChrome } from "../ui/useModalChrome";
import { useOverlayDismiss } from "../ui/useOverlayDismiss";
import "./FeedbackModal.css";

const WEBHOOK_URL = import.meta.env.VITE_DISCORD_WEBHOOK as string;

function detectOS(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Linux")) return "Linux";
  return "Unknown";
}

function hostOf(serverUrl: string | undefined): string {
  if (!serverUrl) return "(none)";
  try {
    return new URL(serverUrl).hostname;
  } catch {
    return "(unknown)";
  }
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

// Discord refuses an embed whose description runs past this, so a longer report rides as a file.
const DISCORD_DESCRIPTION_LIMIT = 4096;
const OVERFLOW_NOTE = "\n\n*(full text attached)*";

const SENT_CLOSE_DELAY_MS = 1400;

const STEPS_PLACEHOLDER = "1. Open the app\n2. …\n3. …";

interface Props {
  serverUrl?: string;
  onClose: () => void;
  initialCategory?: Category;
  initialText?: string;
}

export function FeedbackModal({ serverUrl, onClose, initialCategory, initialText }: Props) {
  const [category, setCategory] = useState<Category>(initialCategory ?? "general");
  const [text, setText] = useState(initialText ?? "");
  const [steps, setSteps] = useState("");
  const [stepsError, setStepsError] = useState(false);
  const [includeSysInfo, setIncludeSysInfo] = useState(true);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [appVersion, setAppVersion] = useState("…");

  useEffect(() => {
    void getVersion().then(setAppVersion);
  }, []);

  // The parent passes a fresh onClose each render; depending on it would restart the delay.
  const closeAfterSent = useEffectEvent(() => onClose());
  useEffect(() => {
    if (status !== "sent") return;
    const timer = setTimeout(closeAfterSent, SENT_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const serverHost = hostOf(serverUrl);
  const chrome = useModalChrome(onClose);
  const dismiss = useOverlayDismiss(onClose);

  async function submit() {
    if (status === "sending") return;
    if (category === "bug") {
      if (!steps.trim()) {
        setStepsError(true);
        return;
      }
    } else {
      if (!text.trim()) return;
    }
    setStepsError(false);
    setStatus("sending");

    const sysLine = includeSysInfo ? `\n\n*Canon v${appVersion} · ${detectOS()} · ${serverHost}*` : "";

    let bodyText: string;
    if (category === "bug") {
      const parts: string[] = [];
      if (text.trim()) parts.push(`**Description**\n${text.trim()}`);
      parts.push(`**Steps to reproduce**\n${steps.trim()}`);
      bodyText = parts.join("\n\n");
    } else {
      bodyText = text.trim();
    }

    const fullText = bodyText + sysLine;
    const isOverLimit = fullText.length > DISCORD_DESCRIPTION_LIMIT;
    const embed = {
      title: `${CATEGORY_EMOJI[category]} ${CATEGORY_LABELS[category]}`,
      description: isOverLimit
        ? `${fullText.slice(0, DISCORD_DESCRIPTION_LIMIT - OVERFLOW_NOTE.length)}${OVERFLOW_NOTE}`
        : fullText,
      color: CATEGORY_COLOR[category],
      timestamp: new Date().toISOString(),
    };

    try {
      const payload = { embeds: [embed] };
      const attachments: { name: string; text: string }[] = [];
      if (isOverLimit) attachments.push({ name: "canon-feedback.txt", text: fullText });
      if (includeLogs) attachments.push({ name: "canon-logs.txt", text: await logger.getRecent(500) });
      let res: Response;
      if (attachments.length > 0) {
        const form = new FormData();
        form.append("payload_json", JSON.stringify(payload));
        attachments.forEach(({ name, text: content }, index) => {
          form.append(`files[${index}]`, new Blob([content], { type: "text/plain" }), name);
        });
        res = await boundedFetch(WEBHOOK_URL, { method: "POST", body: form }, { headersTimeoutMs: UPLOAD_TIMEOUT_MS });
      } else {
        res = await boundedFetch(WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="feedback-overlay" {...dismiss}>
      <div className="feedback-modal" {...chrome}>
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
              onClick={() => {
                setCategory(c);
                setStepsError(false);
              }}
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
              onChange={(e) => {
                setSteps(e.target.value);
                if (e.target.value.trim()) setStepsError(false);
              }}
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
          <div className="feedback-checks">
            <label className="feedback-sysinfo">
              <input type="checkbox" checked={includeSysInfo} onChange={(e) => setIncludeSysInfo(e.target.checked)} />
              <span>Include system info</span>
              {includeSysInfo && (
                <span className="feedback-sysinfo-detail">
                  v{appVersion} · {detectOS()} · {serverHost}
                </span>
              )}
            </label>
            <label className="feedback-sysinfo">
              <input type="checkbox" checked={includeLogs} onChange={(e) => setIncludeLogs(e.target.checked)} />
              <span>Include recent logs</span>
            </label>
          </div>
          <div className="feedback-footer-right">
            {status === "error" && (
              <span className="feedback-status feedback-status--error">Send failed, try again</span>
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
