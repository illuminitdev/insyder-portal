import { sourceQualityHint } from "../signalScoring.js";
import { sourceAttribution } from "../drafts.js";
import type { RawEvidenceInput, EvidenceVerificationResult } from "./types.js";

const UNSUPPORTED_CLAIM_PATTERNS = [
  /\b(?:scaling globally|expanding across the globe|global dominance|conquering markets)\b/i,
  /\b(?:opened (?:a )?new site|launching (?:a )?new facility)\b/i,
];

/**
 * Verifies the credibility, freshness, and claim validity of raw evidence.
 */
export function verifyEvidence(input: RawEvidenceInput): EvidenceVerificationResult {
  const { rawExcerpt, sourceTitle, publisher, canonicalUrl } = input;
  const reasons: string[] = [];

  const text = `${sourceTitle ?? ""} ${rawExcerpt ?? ""}`.trim();
  const attribution = sourceAttribution({ publisher, canonicalUrl });

  // 1. Check Source Credibility using Insyder's sourceQualityHint
  const credibilityScore = sourceQualityHint(canonicalUrl ?? "", null);

  let credibilityTier = "unknown";
  if (credibilityScore >= 90) credibilityTier = "official_or_first_party";
  else if (credibilityScore >= 75) credibilityTier = "major_or_trade_press";
  else if (credibilityScore >= 65) credibilityTier = "press_wire_or_job_board";
  else if (credibilityScore >= 40) credibilityTier = "directory";
  else credibilityTier = "user_content";

  // 2. Detect ungrounded expansion claims
  let hasUnsupportedClaims = false;
  const isJobBoard =
    (canonicalUrl && /greenhouse\.io|lever\.co|workday|linkedin\.com\/jobs|careers|jobs\./i.test(canonicalUrl)) ||
    (publisher && /greenhouse|lever|workday|job board/i.test(publisher));

  if (isJobBoard) {
    for (const pattern of UNSUPPORTED_CLAIM_PATTERNS) {
      if (pattern.test(text)) {
        hasUnsupportedClaims = true;
        reasons.push("Job posting evidence cannot be used to substantiate ungrounded claims of global scaling or new facility launches.");
        break;
      }
    }
  }

  // 3. Verifiability check: must have either clean text or title, and valid publisher/domain
  const hasText = text.length >= 15;
  const hasSource = Boolean(canonicalUrl || publisher);
  const verified = hasText && hasSource && !hasUnsupportedClaims && credibilityScore >= 40;

  if (!hasText) reasons.push("Evidence text is too sparse to verify.");
  if (!hasSource) reasons.push("Missing source attribution or URL.");
  if (credibilityScore < 40) reasons.push("Source domain has low credibility (unverified directory or user content).");

  return {
    verified,
    credibilityScore,
    credibilityTier,
    hasUnsupportedClaims,
    reasons,
  };
}
