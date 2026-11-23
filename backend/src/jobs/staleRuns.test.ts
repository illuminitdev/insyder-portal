import { describe, expect, it } from "vitest";
import { STALE_AFTER_MINUTES, staleCutoff } from "./staleRuns.js";

describe("stale research run cutoff", () => {
  const now = new Date("2026-11-11T12:00:00Z");

  it("treats account and discovery runs as stuck after the short window", () => {
    expect(staleCutoff("account", now).getTime()).toBe(now.getTime() - STALE_AFTER_MINUTES.other * 60_000);
    expect(staleCutoff("discovery", now).getTime()).toBe(now.getTime() - STALE_AFTER_MINUTES.other * 60_000);
  });

  it("gives list builds (webset) longer, since they wait and retry", () => {
    expect(staleCutoff("webset", now).getTime()).toBe(now.getTime() - STALE_AFTER_MINUTES.webset * 60_000);
    expect(STALE_AFTER_MINUTES.webset).toBeGreaterThan(STALE_AFTER_MINUTES.other);
  });
});
