import { describe, expect, it } from "vitest";
import { msUntilNextDailyRun, parseDailyTimeUtc } from "../jobs/dailySchedule.js";
import { isMonitorDue, MONITOR_DUE_GRACE_HOURS } from "../services/monitors.js";

describe("parseDailyTimeUtc", () => {
  it("parses HH:MM", () => {
    expect(parseDailyTimeUtc("03:30")).toBe(210);
    expect(parseDailyTimeUtc("0:05")).toBe(5);
    expect(parseDailyTimeUtc("23:59")).toBe(23 * 60 + 59);
  });
  it("falls back to 03:30 on bad or missing input", () => {
    expect(parseDailyTimeUtc(undefined)).toBe(210);
    expect(parseDailyTimeUtc("")).toBe(210);
    expect(parseDailyTimeUtc("24:00")).toBe(210);
    expect(parseDailyTimeUtc("12:60")).toBe(210);
    expect(parseDailyTimeUtc("noon")).toBe(210);
  });
  it("uses a custom fallback", () => {
    expect(parseDailyTimeUtc("bad", "06:00")).toBe(360);
  });
});

describe("msUntilNextDailyRun", () => {
  it("runs later today when the time is still ahead", () => {
    expect(msUntilNextDailyRun(210, new Date("2026-11-24T03:00:00Z"))).toBe(30 * 60_000);
  });
  it("runs tomorrow when the time has passed", () => {
    expect(msUntilNextDailyRun(210, new Date("2026-11-24T04:00:00Z"))).toBe(23.5 * 3600_000);
  });
  it("is never zero: exactly at the time means tomorrow", () => {
    expect(msUntilNextDailyRun(210, new Date("2026-11-24T03:30:00Z"))).toBe(24 * 3600_000);
  });
});

describe("daily monitor grace", () => {
  const lastAttemptAt = new Date("2026-11-23T03:30:40Z");
  const now = new Date("2026-11-24T03:30:00Z").getTime();

  it("is due at the next daily run with the grace, though 24 h have not quite passed", () => {
    expect(isMonitorDue({ lastAttemptAt, cadenceHours: 24 }, now, MONITOR_DUE_GRACE_HOURS)).toBe(true);
  });
  it("is not due without the grace", () => {
    expect(isMonitorDue({ lastAttemptAt, cadenceHours: 24 }, now)).toBe(false);
  });
  it("a monitor checked 15 minutes ago is not due even with the grace", () => {
    const recent = new Date(now - 15 * 60_000);
    expect(isMonitorDue({ lastAttemptAt: recent, cadenceHours: 24 }, now, MONITOR_DUE_GRACE_HOURS)).toBe(false);
  });
});
