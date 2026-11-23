export function Card({
  children,
  className = "",
  accent = false,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-100 bg-white p-5 sm:p-6 shadow-[0_2px_16px_rgba(0,0,0,0.03)] transition-all ${
        accent ? "border-t-[3px] border-t-[var(--brand)]" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
