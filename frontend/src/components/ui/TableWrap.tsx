export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-[0_2px_14px_rgba(0,0,0,0.03)]">
      {children}
    </div>
  );
}
