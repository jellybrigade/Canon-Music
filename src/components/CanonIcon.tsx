interface Props {
  size?: number;
  className?: string;
}

const SW = 4.5;
const C = "round" as const;

function Mark() {
  return <>
    <line x1="72.15" y1="64.15" x2="76.4"  y2="68.4"  stroke="currentColor" strokeWidth={SW} strokeLinecap={C}/>
    <line x1="63.2"  y1="69.3"  x2="65.5"  y2="78.0"  stroke="currentColor" strokeWidth={SW} strokeLinecap={C}/>
    <line x1="52.8"  y1="69.3"  x2="49.9"  y2="81.1"  stroke="currentColor" strokeWidth={SW} strokeLinecap={C}/>
    <line x1="43.85" y1="64.15" x2="33.25" y2="74.75" stroke="currentColor" strokeWidth={SW} strokeLinecap={C}/>
    <line x1="38.7"  y1="55.2"  x2="22.25" y2="59.6"  stroke="currentColor" strokeWidth={SW} strokeLinecap={C}/>
    <line x1="38.7"  y1="44.8"  x2="22.25" y2="40.4"  stroke="currentColor" strokeWidth={SW} strokeLinecap={C}/>
    <line x1="43.85" y1="35.85" x2="33.25" y2="25.25" stroke="currentColor" strokeWidth={SW} strokeLinecap={C}/>
    <line x1="52.8"  y1="30.7"  x2="49.9"  y2="18.9"  stroke="currentColor" strokeWidth={SW} strokeLinecap={C}/>
    <line x1="63.2"  y1="30.7"  x2="65.5"  y2="22.0"  stroke="currentColor" strokeWidth={SW} strokeLinecap={C}/>
    <line x1="72.15" y1="35.85" x2="76.4"  y2="31.6"  stroke="currentColor" strokeWidth={SW} strokeLinecap={C}/>
  </>;
}

export function CanonIcon({ size = 24, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <Mark/>
    </svg>
  );
}

export function CanonLockup({ height = 28, className }: { height?: number; className?: string }) {
  // viewBox: 100 (icon) + 16 (gap) + 180 (text) = 296 wide, 100 tall
  const width = height * (296 / 100);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 296 100"
      width={width}
      height={height}
      className={className}
      aria-label="Canon"
    >
      <Mark/>
      <text
        x="116"
        y="72"
        fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
        fontSize="68"
        fontWeight="500"
        fill="currentColor"
        letterSpacing="-2"
      >canon</text>
    </svg>
  );
}
