// No "use client": plain SVG, so the auth pages can render it without pulling in the workspace sidebar.
export function KolamMark({ size = 26, dark }: { size?: number; dark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      {[12, 20, 28].map((x) => [12, 20, 28].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill={dark ? "#0f1113" : "#fff"} opacity=".7" />))}
      <path d="M20 5c7 0 7 10 0 10s-7-10 0-10Zm0 20c7 0 7 10 0 10s-7-10 0-10ZM5 20c0-7 10-7 10 0s-10 7-10 0Zm20 0c0-7 10-7 10 0s-10 7-10 0Z" fill="none" stroke={dark ? "#0f1113" : "var(--brand)"} strokeWidth="2.4" />
    </svg>
  );
}
