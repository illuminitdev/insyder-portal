export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-brand-50/90 border border-brand-100/90 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-[var(--brand-text)] shadow-2xs">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
      <span>{children}</span>
    </div>
  );
}
