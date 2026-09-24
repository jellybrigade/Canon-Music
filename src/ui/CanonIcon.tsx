import markSvg from "../assets/canon-logo-kit/canon-mark-currentcolor.svg?raw";
import lockupSvg from "../assets/canon-logo-kit/canon-lockup-currentcolor.svg?raw";
import "./CanonIcon.css";

interface Props {
  size?: number;
  className?: string;
}

const MARK_ASPECT = 52 / 92;
const LOCKUP_ASPECT = 315.9 / 52;

export function CanonIcon({ size = 24, className }: Props) {
  return (
    <span
      className={["canon-logo-mark", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size * MARK_ASPECT }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markSvg }}
    />
  );
}

export function CanonLockup({ height = 28, className }: { height?: number; className?: string }) {
  return (
    <span
      className={["canon-logo-lockup", className].filter(Boolean).join(" ")}
      style={{ width: height * LOCKUP_ASPECT, height }}
      role="img"
      aria-label="Canon"
      dangerouslySetInnerHTML={{ __html: lockupSvg }}
    />
  );
}
