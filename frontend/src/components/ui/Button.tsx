import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary:
    "bg-[var(--brand)] text-[var(--on-gradient)] hover:bg-[var(--brand-hover)] border-transparent font-semibold active:scale-[0.99]",
  secondary:
    "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 font-medium shadow-2xs active:scale-[0.99]",
  ghost:
    "bg-transparent text-slate-600 border-transparent hover:bg-slate-100 hover:text-slate-900 font-medium",
  quiet:
    "bg-transparent text-slate-500 border-transparent hover:text-[var(--brand-active)] font-medium",
} as const;

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-xl border px-3.5 py-2 text-sm transition-all disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
