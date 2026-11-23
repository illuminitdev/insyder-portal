import { verifyEvidence } from "./verifyEvidence.js";
import { classifySignal } from "./classifySignal.js";
import { computeOfferingRelevance, computeSignalConfidence } from "./scoreSignal.js";
import type { BusinessSignal, RawEvidenceInput } from "./types.js";
import { buildBusinessContext } from "./buildBusinessContext.js";

export interface RankedEvidenceResult {
  signal: BusinessSignal;
  rawInput: RawEvidenceInput;
  rankingScore: number;
}

/**
 * Evaluates, scores, and ranks a collection of evidence items to identify the strongest business signals.
 */
export function rankEvidence(items: RawEvidenceInput[], offering?: string | null): RankedEvidenceResult[] {
  const now = Date.now();

  const results: RankedEvidenceResult[] = items.map((input) => {
    // 1. Verification & Credibility
    const verification = verifyEvidence(input);

    // 2. Classification
    const classification = classifySignal({ ...input, offering: input.offering ?? offering });

    // 3. Scoring
    const rawText = `${input.sourceTitle ?? ""} ${input.rawExcerpt ?? ""}`;
    const relevanceScore = computeOfferingRelevance({
      category: classification.category,
      rawText,
      offering,
    });

    const confidence = computeSignalConfidence({
      category: classification.category,
      hasRoleOrEntity: Boolean(classification.role || classification.focusArea),
      credibilityScore: verification.credibilityScore,
      textLength: rawText.length,
    });

    // 4. Business Context
    const { observedFact, potentialBusinessImplication } = buildBusinessContext({
      companyName: input.companyName,
      classification,
      offering,
    });

    // 5. Date Recency Scoring (0 - 100)
    let recencyScore = 50;
    const rawDate = input.eventDate || input.discoveredAt;
    if (rawDate) {
      const dateMs = new Date(rawDate).getTime();
      if (!isNaN(dateMs)) {
        const ageDays = Math.max(0, (now - dateMs) / (1000 * 60 * 60 * 24));
        if (ageDays <= 14) recencyScore = 100;
        else if (ageDays <= 30) recencyScore = 85;
        else if (ageDays <= 60) recencyScore = 70;
        else if (ageDays <= 90) recencyScore = 55;
        else if (ageDays <= 180) recencyScore = 40;
        else recencyScore = 25;
      }
    }

    // 6. Composite Ranking Score
    // Weight: 35% Relevance + 25% Credibility + 25% Recency + 15% Confidence
    let rankingScore =
      relevanceScore * 0.35 +
      verification.credibilityScore * 0.25 +
      recencyScore * 0.25 +
      confidence * 0.15;

    // Bonus for reviewed status
    if (input.reviewedAt) {
      rankingScore += 5;
    }

    // Penalty for unverified or unsupported claims
    if (!verification.verified) {
      rankingScore *= 0.7;
    }

    const sourceDate = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : null;

    const signal: BusinessSignal = {
      category: classification.category,
      observedFact,
      potentialBusinessImplication,
      sourceUrl: input.canonicalUrl ?? "",
      sourceDate,
      confidence,
      relevanceScore,
      verified: verification.verified,
      publisher: classification.attribution,
      credibilityTier: verification.credibilityTier,
      role: classification.role,
      responsibilities: classification.responsibilities,
      focusArea: classification.focusArea,
      summary: classification.rawSummary,
    };

    return {
      signal,
      rawInput: input,
      rankingScore: Math.round(rankingScore * 10) / 10,
    };
  });

  // Sort descending by rankingScore
  return results.sort((a, b) => b.rankingScore - a.rankingScore);
}

