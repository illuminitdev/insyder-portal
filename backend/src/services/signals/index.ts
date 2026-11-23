/**
 * Business Signal Intelligence Layer public exports.
 */

export * from "./types.js";
export * from "./classifySignal.js";
export * from "./verifyEvidence.js";
export * from "./scoreSignal.js";
export * from "./buildBusinessContext.js";
export * from "./deduplicateEvidence.js";
export * from "./rankEvidence.js";

import { rankEvidence } from "./rankEvidence.js";
import { deduplicateEvidence } from "./deduplicateEvidence.js";
import type { BusinessSignal, RawEvidenceInput } from "./types.js";

/**
 * Extracts a structured, verified, and scored BusinessSignal from raw evidence.
 */
export function extractIntelligentSignal(input: RawEvidenceInput): BusinessSignal {
  const ranked = rankEvidence([input], input.offering);
  return ranked[0]!.signal;
}

/**
 * Processes a list of raw evidence items: deduplicates, verifies, scores, and ranks them.
 */
export function processEvidenceList(items: RawEvidenceInput[], offering?: string | null): BusinessSignal[] {
  const deduped = deduplicateEvidence(items);
  const ranked = rankEvidence(deduped, offering);
  return ranked.map((r) => r.signal);
}

