import { describe, expect, it } from "vitest";
import { parseGates } from "./acceptance.js";

describe("parseGates", () => {
  it("defaults to the full review workflow", () => {
    expect(parseGates("{}")).toEqual({ requiredKnownFields: [], skipReview: false });
    expect(parseGates(null)).toEqual({ requiredKnownFields: [], skipReview: false });
    expect(parseGates("not json")).toEqual({ requiredKnownFields: [], skipReview: false });
  });

  it("reads skip review only when it is exactly true", () => {
    expect(parseGates('{"skipReview":true,"requiredKnownFields":["timeline"]}')).toEqual({
      requiredKnownFields: ["timeline"],
      skipReview: true,
    });
    expect(parseGates('{"skipReview":"yes"}').skipReview).toBe(false);
  });
});
