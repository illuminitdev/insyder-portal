import { describe, expect, it } from "vitest";
import { normalizeHex, parseBranding, validateBranding } from "./branding.js";

describe("workspace branding", () => {
  it("normalises hex colours", () => {
    expect(normalizeHex("#0D1B2A")).toBe("#0d1b2a");
    expect(normalizeHex("0d1b2a")).toBe("#0d1b2a");
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex(12)).toBeNull();
  });

  it("accepts readable colours", () => {
    const r = validateBranding({ primary: "#0d1b2a", accent: "#0e6b67", sidebar: "#132538" });
    expect(r).toEqual({ branding: { primary: "#0d1b2a", accent: "#0e6b67", sidebar: "#132538" } });
  });

  it("accepts light colours too (the app picks dark text for them)", () => {
    expect(validateBranding({ primary: "#ffeb3b", accent: "#f20202", sidebar: "#f5f5f5" })).toEqual({
      branding: { primary: "#ffeb3b", accent: "#f20202", sidebar: "#f5f5f5" },
    });
  });

  it("rejects values that are not colours", () => {
    const r = validateBranding({ primary: "red", accent: "#0e6b67", sidebar: "" });
    expect("errors" in r && r.errors).toEqual([expect.stringContaining("Primary colour"), expect.stringContaining("Menu colour")]);
  });

  it("falls back to Insyder colours for missing or broken saved values", () => {
    expect(parseBranding(null)).toBeNull();
    expect(parseBranding("not json")).toBeNull();
    expect(parseBranding(JSON.stringify({ primary: "#fff", accent: "#000" }))).toBeNull();
  });
});
