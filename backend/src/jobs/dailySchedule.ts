const DEFAULT_DAILY_TIME_UTC = "03:30";

function parseHHMM(value: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "HH:MM" (UTC) → minutes after midnight UTC. Bad or missing input uses `fallback` (default 03:30). */
export function parseDailyTimeUtc(value: string | undefined, fallback = DEFAULT_DAILY_TIME_UTC): number {
  return parseHHMM(value) ?? parseHHMM(fallback) ?? 3 * 60 + 30;
}

/** Milliseconds until the UTC clock next reads `minutesUtc` (always > 0; tomorrow if already passed today). */
export function msUntilNextDailyRun(minutesUtc: number, now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(Math.floor(minutesUtc / 60), minutesUtc % 60, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}
