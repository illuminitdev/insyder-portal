const tones = {
  default: "bg-slate-100 text-slate-600 border border-slate-200/50",
  green: "bg-emerald-50 text-emerald-700 border border-emerald-200/50",
  amber: "bg-amber-50 text-amber-700 border border-amber-200/50",
  blue: "bg-indigo-50 text-indigo-700 border border-indigo-200/50",
  red: "bg-rose-50 text-rose-700 border border-rose-200/50",
} as const;

export function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: keyof typeof tones;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-tight ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
