/**
 * Types and interfaces for the Business Signal Intelligence Layer.
 */

export type BusinessSignalCategory =
  | "hiring"
  | "company_expansion"
  | "technology_adoption"
  | "infrastructure_investment"
  | "leadership_change"
  | "digital_transformation"
  | "cloud_migration"
  | "general";

export interface BusinessSignal {
  category: BusinessSignalCategory;
  observedFact: string;
  potentialBusinessImplication: string;
  sourceUrl: string;
  sourceDate: string | null;
  confidence: number; // 0 to 100
  relevanceScore: number; // 0 to 100
  verified: boolean;
  publisher?: string;
  credibilityTier?: string;
  role?: string;
  responsibilities?: string;
  focusArea?: string;
  summary?: string;
}

export interface RawEvidenceInput {
  id?: string;
  rawExcerpt?: string | null;
  sourceTitle?: string | null;
  publisher?: string | null;
  canonicalUrl?: string;
  eventDate?: string | Date | null;
  discoveredAt?: string | Date | null;
  reviewedAt?: string | Date | null;
  companyName: string;
  offering?: string | null;
}

export interface EvidenceVerificationResult {
  verified: boolean;
  credibilityScore: number;
  credibilityTier: string;
  hasUnsupportedClaims: boolean;
  reasons: string[];
}

