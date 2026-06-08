interface Props {
  size?: number;
  className?: string;
}

export function CanonIcon({ size = 24, className }: Props) {
  // Scale to desired height; original viewBox is 82x66
  const width = size * (82 / 66);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 82 66"
      width={width}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <rect x="0"  y="0"  width="68" height="14" rx="7" fill="currentColor"/>
      <rect x="24" y="26" width="50" height="14" rx="7" fill="currentColor"/>
      <rect x="48" y="52" width="34" height="14" rx="7" fill="currentColor"/>
    </svg>
  );
}

export function CanonLockup({ height = 28, className }: { height?: number; className?: string }) {
  // Original lockup viewBox is 420x80
  const width = height * (420 / 80);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 420 80"
      width={width}
      height={height}
      className={className}
      aria-label="Canon"
    >
      <rect x="0"  y="0"  width="68" height="14" rx="7" fill="currentColor"/>
      <rect x="24" y="26" width="50" height="14" rx="7" fill="currentColor"/>
      <rect x="48" y="52" width="34" height="14" rx="7" fill="currentColor"/>
      <text
        x="98"
        y="48"
        fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
        fontSize="52"
        fontWeight="500"
        fill="currentColor"
        letterSpacing="-2"
      >canon</text>
    </svg>
  );
}
