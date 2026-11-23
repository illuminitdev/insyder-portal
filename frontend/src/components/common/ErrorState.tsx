export function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-[10px] border border-[var(--danger-tint)] bg-[var(--danger-tint)] px-4 py-3 text-sm text-[var(--danger)]"
    >
      {message}
    </div>
  );
}
