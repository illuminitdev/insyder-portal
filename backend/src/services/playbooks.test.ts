import { describe, expect, it } from "vitest";
import {
  extractWorkspaceCustomSignals,
  isBuiltIn,
  playbookInputSchema,
  rulesOf,
  SIGNAL_KINDS,
} from "./playbooks.js";

describe("playbook rules", () => {
  it("fills built-in texts for rows saved before they existed", () => {
    const r = rulesOf({ templateKey: "recruitment", rulesJson: JSON.stringify({ signals: ["infra_hiring", "expansion"] }) });
    expect(r.signals).toEqual(["infra_hiring", "expansion"]);
    expect(r.discoveryQuestion).toMatch(/roles/);
    expect(r.archived).toBe(false);
  });

  it("supports the expanded buying signals", () => {
    expect(SIGNAL_KINDS).toContain("cloud_migration");
    expect(SIGNAL_KINDS).toContain("leadership_change");
    expect(SIGNAL_KINDS).toContain("funding");
    expect(SIGNAL_KINDS).toContain("security_compliance");
    expect(SIGNAL_KINDS).toContain("cost_optimization");

    const r = rulesOf({
      templateKey: "custom_cloud",
      rulesJson: JSON.stringify({ signals: ["cloud_migration", "leadership_change", "funding"] }),
    });
    expect(r.signals).toEqual(["cloud_migration", "leadership_change", "funding"]);
  });

  it("drops unknown signal types and keeps custom fields", () => {
    const r = rulesOf({
      templateKey: "custom_x",
      rulesJson: JSON.stringify({ signals: ["refresh", "made_up"], countries: ["GB"], eventWindowDays: 60, archived: true }),
    });
    expect(r.signals).toEqual(["refresh"]);
    expect(r.countries).toEqual(["GB"]);
    expect(r.eventWindowDays).toBe(60);
    expect(r.archived).toBe(true);
  });

  it("preserves custom signals in playbook rules", () => {
    const customSig = { key: "custom_ai_rollout", label: "AI Rollout", description: "Deploying generative AI" };
    const r = rulesOf({
      templateKey: "custom_ai",
      rulesJson: JSON.stringify({
        signals: ["compute", "custom_ai_rollout"],
        customSignals: [customSig],
      }),
    });
    expect(r.signals).toContain("compute");
    expect(r.signals).toContain("custom_ai_rollout");
    expect(r.customSignals).toEqual([customSig]);
  });

  it("extracts workspace custom signals across playbooks", () => {
    const p1 = {
      id: "pbk_1",
      templateKey: "custom_p1",
      name: "Playbook 1",
      version: 1,
      builtIn: false,
      archived: false,
      createdAt: new Date(),
      rules: {
        signals: ["cloud_migration", "custom_esg"],
        customSignals: [{ key: "custom_esg", label: "ESG Initiative", description: "Green data centers" }],
        description: "",
        requiredEvidence: "",
        discoveryQuestion: "",
        countries: [],
        industries: [],
        eventWindowDays: null,
      },
    };
    const p2 = {
      id: "pbk_2",
      templateKey: "custom_p2",
      name: "Playbook 2",
      version: 1,
      builtIn: false,
      archived: false,
      createdAt: new Date(),
      rules: {
        signals: ["custom_esg", "custom_erp_migration"],
        customSignals: [{ key: "custom_esg", label: "ESG Initiative" }],
        description: "",
        requiredEvidence: "",
        discoveryQuestion: "",
        countries: [],
        industries: [],
        eventWindowDays: null,
      },
    };
    const extracted = extractWorkspaceCustomSignals([p1, p2]);
    expect(extracted).toHaveLength(2);
    expect(extracted.find((s) => s.key === "custom_esg")?.label).toBe("ESG Initiative");
    expect(extracted.find((s) => s.key === "custom_erp_migration")?.label).toBe("Erp migration");
  });

  it("survives broken JSON", () => {
    expect(rulesOf({ templateKey: "custom_y", rulesJson: "{" }).signals.length).toBeGreaterThan(0);
  });

  it("requires a name and at least one signal", () => {
    expect(playbookInputSchema.safeParse({ name: "Data centre builds", signals: [] }).success).toBe(false);
    expect(playbookInputSchema.safeParse({ name: "D", signals: ["compute"] }).success).toBe(false);
    expect(playbookInputSchema.safeParse({ name: "Data centre builds", signals: ["compute"] }).success).toBe(true);
    expect(
      playbookInputSchema.safeParse({
        name: "AI Strategy",
        signals: ["custom_ai"],
        customSignals: [{ key: "custom_ai", label: "AI" }],
      }).success,
    ).toBe(true);
  });

  it("knows the built-ins", () => {
    expect(isBuiltIn("infrastructure")).toBe(true);
    expect(isBuiltIn("cloud_modernization")).toBe(true);
    expect(isBuiltIn("custom_abc")).toBe(false);
  });
});
