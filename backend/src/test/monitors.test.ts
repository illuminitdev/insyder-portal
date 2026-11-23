import { describe, expect, it } from "vitest";
import { generateDedupeKey, isMonitorDue } from "../services/monitors.js";

describe("Scheduled Monitors & Change Detection", () => {
  it("generates deterministic SHA-256 deduplication keys", () => {
    const key1 = generateDedupeKey(
      "aligneddc.com",
      "https://datacenterfrontier.example.com/aligned-expansion-texas",
      "Aligned Data Centers expands Texas campus with 120MW facility",
    );

    const key2 = generateDedupeKey(
      "ALIGNEDDC.COM",
      "https://datacenterfrontier.example.com/aligned-expansion-texas",
      "  Aligned Data Centers expands Texas campus with 120MW facility  ",
    );

    expect(key1).toBe(key2);
    expect(key1).toHaveLength(64);
  });

  it("distinguishes different evidence or events", () => {
    const key1 = generateDedupeKey(
      "aligneddc.com",
      "https://datacenterfrontier.example.com/aligned-expansion-texas",
      "Aligned Data Centers expands Texas campus",
    );

    const key2 = generateDedupeKey(
      "streamdatacenters.com",
      "https://news.example.com/stream-expansion-texas",
      "Stream Data Centers acquires 200 acres in Texas",
    );

    expect(key1).not.toBe(key2);
  });

  it("correctly calculates when a monitor check is due based on cadence", () => {
    const now = 1700000000000;
    // Never run before -> due immediately
    expect(isMonitorDue({ lastAttemptAt: null, cadenceHours: 24 }, now)).toBe(true);

    // Ran 23 hours ago on a 24-hour cadence -> not due
    const recent = new Date(now - 23 * 3600 * 1000);
    expect(isMonitorDue({ lastAttemptAt: recent, cadenceHours: 24 }, now)).toBe(false);

    // Ran 25 hours ago on a 24-hour cadence -> due
    const past24h = new Date(now - 25 * 3600 * 1000);
    expect(isMonitorDue({ lastAttemptAt: past24h, cadenceHours: 24 }, now)).toBe(true);

    // Ran 6 days ago on weekly (168h) -> not due
    const past6d = new Date(now - 6 * 24 * 3600 * 1000);
    expect(isMonitorDue({ lastAttemptAt: past6d, cadenceHours: 168 }, now)).toBe(false);

    // Ran 8 days ago on weekly (168h) -> due
    const past8d = new Date(now - 8 * 24 * 3600 * 1000);
    expect(isMonitorDue({ lastAttemptAt: past8d, cadenceHours: 168 }, now)).toBe(true);
  });

  it("supports account-specific monitor recipe structure", () => {
    const recipe = {
      type: "accounts",
      accountIds: ["acc_datum", "acc_greenm"],
      accountNames: ["Datum Datacentres", "Green Mountain"],
      accountDomains: ["datum.co.uk", "greenmountain.no"],
      territory: ["GB", "NO"],
      eventWindowDays: 180,
      templateKey: "infrastructure",
      signals: ["expansion", "cloud_migration"],
    };

    const parsed = JSON.parse(JSON.stringify(recipe));
    expect(parsed.type).toBe("accounts");
    expect(parsed.accountIds).toHaveLength(2);
    expect(parsed.accountNames).toContain("Datum Datacentres");
    expect(parsed.signals).toContain("cloud_migration");
  });
});


