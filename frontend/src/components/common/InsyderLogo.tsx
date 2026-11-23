/**
 * Insyder brand mark: two bracket corners framing a bar, with a teal "signal" square on top.
 * Bracket and bar use currentColor (white on the navy tile), the square stays teal.
 */
export function InsyderMark({ size = 24, accent = "#7FD3CB" }: { size?: number; accent?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden className="relative">
      <path d="M5 17V9a4 4 0 0 1 4-4h8" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M43 31v8a4 4 0 0 1-4 4h-8" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <rect x="20.5" y="20" width="7" height="17" rx="1.5" fill="currentColor" />
      <rect x="20.5" y="10" width="7" height="7" rx="1.5" fill={accent} />
    </svg>
  );
}

/** Navy rounded tile holding the mark, used wherever the old red app icon was. */
export function InsyderTile({ size = 34, radius = 9 }: { size?: number; radius?: number }) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-b from-[#16304a] to-[#0D1B2A] text-white"
      style={{ width: size, height: size, borderRadius: radius }}
      aria-hidden
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent" />
      <InsyderMark size={Math.round(size * 0.56)} />
    </span>
  );
}

/** Lowercase "insyder" wordmark in the heading font, as on the Insyder site. */
export function InsyderWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-[family-name:var(--font-heading)] font-bold lowercase tracking-[-0.045em] ${className}`}>
      insyder
    </span>
  );
}
