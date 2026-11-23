import type { BusinessSignalCategory } from "./types.js";

/**
 * Computes confidence score (0 to 100) based on signal structure, entity extraction, and credibility.
 */
export function computeSignalConfidence(params: {
  category: BusinessSignalCategory;
  hasRoleOrEntity: boolean;
  credibilityScore: number;
  textLength: number;
}): number {
  const { category, hasRoleOrEntity, credibilityScore, textLength } = params;
  let score = 50;

  // Credibility weight (up to 30 points)
  score += Math.round((credibilityScore / 100) * 30);

  // Specificity bonus (up to 20 points)
  if (hasRoleOrEntity) score += 15;
  if (textLength >= 80) score += 5;

  // Category specific baselines
  if (category === "cloud_migration" || category === "infrastructure_investment") {
    score += 5;
  } else if (category === "leadership_change" && hasRoleOrEntity) {
    score += 8;
  } else if (category === "general") {
    score -= 10;
  }

  return Math.max(10, Math.min(100, score));
}

/**
 * Computes semantic relevance score (0 to 100) between the signal and workspace offering.
 */
export function computeOfferingRelevance(params: {
  category: BusinessSignalCategory;
  rawText: string;
  offering?: string | null;
}): number {
  const { category, rawText, offering } = params;
  if (!offering || !offering.trim()) return 70; // neutral default when workspace has not set an offering

  const lowerOffer = offering.toLowerCase();
  const lowerText = rawText.toLowerCase();

  let relevance = 60;

  // Category alignments with common B2B offerings
  if (lowerOffer.includes("cloud") || lowerOffer.includes("infrastructure") || lowerOffer.includes("server") || lowerOffer.includes("compute")) {
    if (category === "cloud_migration" || category === "infrastructure_investment") {
      relevance += 30;
    } else if (category === "hiring" && (lowerText.includes("infrastructure") || lowerText.includes("cloud") || lowerText.includes("data centre") || lowerText.includes("data center") || lowerText.includes("compute") || lowerText.includes("hpc"))) {
      relevance += 25;
    } else if (category === "technology_adoption" || category === "digital_transformation") {
      relevance += 20;
    }
  } else if (lowerOffer.includes("recruitment") || lowerOffer.includes("hiring") || lowerOffer.includes("talent") || lowerOffer.includes("staffing")) {
    if (category === "hiring" || category === "leadership_change") {
      relevance += 35;
    }
  } else if (lowerOffer.includes("security") || lowerOffer.includes("cyber")) {
    if (lowerText.includes("ciso") || lowerText.includes("security") || lowerText.includes("compliance") || lowerText.includes("soc")) {
      relevance += 35;
    }
  }

  // Direct keyword intersections
  const keywords = lowerOffer.split(/\s+/).filter((w) => w.length > 3);
  let keywordHits = 0;
  for (const kw of keywords) {
    if (lowerText.includes(kw)) keywordHits++;
  }
  relevance += Math.min(15, keywordHits * 5);

  return Math.max(20, Math.min(100, relevance));
}

