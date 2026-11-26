import { describe, expect, it } from "vitest";
import { isPlanKey, listPlans, nearestAllowedCadence, planOf, PLANS } from "./plans.js";

describe("plans", () => {
  it("matches the agreed limits", () => {
    expect(PLANS.starter).toMatchObject({ price: 40, researchUnits: 100, maxWorkspaces: 1, maxUsers: 4, monitorCadenceHours: [720] });
    expect(PLANS.growth).toMatchObject({ price: 80, researchUnits: 250, maxWorkspaces: 3, maxUsers: 10, monitorCadenceHours: [168, 720] });
    expect(PLANS.enterprise).toMatchObject({ price: 150, researchUnits: 500, maxWorkspaces: 6, maxUsers: 20, monitorCadenceHours: [24, 168] });
  });

  it("falls back to Starter for unknown or missing plans", () => {
    expect(planOf(null).key).toBe("starter");
    expect(planOf("platinum").key).toBe("starter");
    expect(planOf("growth").key).toBe("growth");
    expect(isPlanKey("enterprise")).toBe(true);
    expect(isPlanKey("toString")).toBe(false);
  });

  it("labels monitor cadences for the UI", () => {
    const growth = listPlans().find((p) => p.key === "growth")!;
    expect(growth.monitorCadences.map((c) => c.label)).toEqual(["Weekly", "Monthly"]);
  });
});

describe("nearestAllowedCadence (monitors after a plan change)", () => {
  it("keeps an allowed cadence", () => {
    expect(nearestAllowedCadence(168, [24, 168])).toBe(168);
  });
  it("moves daily and weekly to monthly on Starter", () => {
    expect(nearestAllowedCadence(24, PLANS.starter.monitorCadenceHours)).toBe(720);
    expect(nearestAllowedCadence(168, PLANS.starter.monitorCadenceHours)).toBe(720);
  });
  it("moves daily to weekly on Growth", () => {
    expect(nearestAllowedCadence(24, PLANS.growth.monitorCadenceHours)).toBe(168);
  });
  it("moves monthly to weekly on Enterprise", () => {
    expect(nearestAllowedCadence(720, PLANS.enterprise.monitorCadenceHours)).toBe(168);
  });
  it("prefers the less frequent cadence on a tie", () => {
    expect(nearestAllowedCadence(96, [24, 168])).toBe(168);
  });
});
