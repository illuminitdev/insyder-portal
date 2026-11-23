import { Card } from "./Card";

export function KpiTile({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="!p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-50 text-slate-400 border border-slate-100">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
        </span>
      </div>
      <p className="mt-2 text-[28px] sm:text-[32px] font-extrabold leading-tight tracking-tight text-slate-900">
        {value}
      </p>
    </Card>
  );
}
