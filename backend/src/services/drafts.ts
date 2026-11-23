import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  accounts,
  contacts,
  drafts,
  evidence,
  offers,
  qualificationFacts,
  qualifications,
  researchRuns,
  sources,
  users,
} from "../db/schema/index.js";
import { conflict, notFound, validationError } from "../utils/errors.js";
import { newId } from "../utils/ids.js";
import { evidenceFreshness } from "./evidence.js";
import { writeAudit } from "./audit.js";
import { BUILT_IN_PLAYBOOKS, getPlaybookVersion, latestPlaybook, type PlaybookView } from "./playbooks.js";
import { listPeople } from "./contacts.js";
import {
  deduplicateEvidence,
  rankEvidence,
  extractIntelligentSignal,
  detectOfferingCategory,
  type BusinessSignal,
  type RawEvidenceInput,
} from "./signals/index.js";

/**
 * Common job listing and press scrape headers that should never appear in outreach.
 */
const SCRAPE_BOILERPLATE_REGEX =
  /^(the opportunity|about (the role|us|our team|this position)|position summary|role overview|who we are|what you'll do|overview|summary|responsibilities|job description|home|services|solutions|company overview):?\s*/i;

const JOB_LEGAL_BOILERPLATE_REGEX =
  /(equal opportunity employer|all qualified applicants will receive|competitive compensation|we are an equal opportunity|affirmative action employer|benefits include|salary range).*$/i;

/**
 * Cleans web excerpts and titles by stripping scrape artifacts, quotes, extra whitespace,
 * boilerplate headers, and cleanly truncating on word boundaries.
 */
export function cleanExcerpt(raw: string | null | undefined, fallbackTitle?: string | null): string {
  const text = (raw ?? fallbackTitle ?? "").trim();
  if (!text) return "";

  // 1. Strip raw URLs and HTML tags
  let cleaned = text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // 2. Strip leading markdown headers (#, ##, etc.) and list bullets
  cleaned = cleaned.replace(/^#+\s*/gm, "").replace(/^[-*•]\s*/gm, "").trim();

  // 3. Strip website metadata prefixes and domain names
  cleaned = cleaned.replace(/^[A-Za-z0-9\s&.-]*(?:website|site|url|homepage|domain):\s*(?:https?:\/\/)?[\w.-]+\.[a-z]{2,}(?:\/\S*)?\s*/i, "");
  cleaned = cleaned.replace(/\b(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.(?:co\.uk|com|io|org|net|ai|eu|de|fr|info)\b/gi, "");

  // 4. Strip leading section titles (e.g. "The Opportunity", "About The Role")
  cleaned = cleaned.replace(SCRAPE_BOILERPLATE_REGEX, "");

  // 5. Strip first-person promotional assertions at the start of website copy
  cleaned = cleaned.replace(/^(?:at\s+[A-Za-z0-9\s&.-]+,\s*)?(?:we\s+(?:specialize|specialise)\s+in|we\s+provide|we\s+offer|we\s+are\s+(?:a|an)?|our\s+mission\s+is\s+to|our\s+focus\s+is\s+on)\s+/i, "");

  // 6. Strip legal/benefits boilerplate that commonly appears at the end of job scraps
  cleaned = cleaned.replace(JOB_LEGAL_BOILERPLATE_REGEX, "");

  // 7. Strip outer quotes, dashes, ellipses, hash markers, colons, and punctuation
  cleaned = cleaned
    .replace(/^["'“”‘`\-–—…\.\s#:]+/, "")
    .replace(/["'“”‘`\-–—…\.\s]+$/, "")
    .trim();

  if (!cleaned) return "";

  // Capitalize first character
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

  if (cleaned.length > 200) {
    const truncated = cleaned.slice(0, 197);
    const lastSpace = truncated.lastIndexOf(" ");
    cleaned = (lastSpace > 130 ? truncated.slice(0, lastSpace) : truncated) + "…";
  }

  return cleaned;
}

/**
 * Derives a clean publisher name or domain from source metadata.
 */
export function sourceAttribution(source: { publisher?: string | null; canonicalUrl?: string }): string {
  if (source.publisher?.trim()) {
    return source.publisher.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  }
  if (!source.canonicalUrl) return "";
  try {
    const parsed = new URL(source.canonicalUrl);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/**
 * Formats an ISO or string event date into a natural conversational timing phrase,
 * e.g. "this March" or "in March 2026" so facts are properly framed and stale signals
 * are accurately contextualized.
 */
export function formatSignalTiming(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const month = months[d.getUTCMonth()];
    const now = new Date();
    const isCurrentYear = d.getUTCFullYear() === now.getUTCFullYear();
    return isCurrentYear ? `this ${month}` : `in ${month} ${d.getUTCFullYear()}`;
  } catch {
    return "";
  }
}

export interface SellerContext {
  sellerCompany?: string | null;
  sellerOffering?: string | null;
  authorName?: string | null;
  offerItems?: Array<{ name: string; description?: string }>;
}

/**
 * Safely extracts the first name from a full contact name, stripping prefixes
 * like Dr., Prof., Mr., Ms., etc., while gracefully falling back to {{first_name}}.
 */
export function extractFirstName(fullName?: string | null): string {
  if (!fullName || !fullName.trim()) return "{{first_name}}";

  let clean = fullName.trim();

  // Strip common honorific prefixes
  clean = clean.replace(/^(?:dr|prof|professor|mr|mrs|ms|miss|sir)\.?\s+/i, "");

  // Match the first word containing letters
  const match = clean.match(/^([A-Za-z]+)/);
  if (!match || !match[1]) return "{{first_name}}";

  const first = match[1];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export interface ContactCandidate {
  id: string;
  name: string;
  title?: string | null;
  buyingRole?: string | null;
  email?: string | null;
  sourceNote?: string | null;
  suppressed?: boolean;
}

/**
 * Intelligently ranks multiple contacts to select the highest-affinity decision maker
 * for the observed business signal and outreach channel.
 */
export function rankContactsForSignal(
  candidates: ContactCandidate[],
  signalCategory?: string | null,
  channel: string = "email",
  offering?: string | null,
): ContactCandidate | null {
  if (!candidates.length) return null;

  // Exclude suppressed contacts
  const available = candidates.filter((c) => !c.suppressed);
  if (!available.length) return candidates[0] ?? null;

  const offerCat = detectOfferingCategory(offering);

  const scored = available.map((c) => {
    let score = 50;
    const title = (c.title ?? "").toLowerCase();
    const role = (c.buyingRole ?? "unknown").toLowerCase();

    // 1. Offering & Signal topic affinity
    if (offerCat === "recruitment") {
      if (/talent|recruiting|recruitment|people|people ops|talent acquisition|hiring/i.test(title)) {
        score += 35;
      } else if (/engineering|technology|technical|vp|cto|head of|director/i.test(title)) {
        score += 25;
      }
    } else if (signalCategory === "cloud_migration" || signalCategory === "infrastructure_investment") {
      if (/infra|infrastructure|cloud|platform|devops|sre|systems|compute|datacenter|data centre/i.test(title)) {
        score += 35;
      }
    } else if (signalCategory === "digital_transformation" || signalCategory === "technology_adoption") {
      if (/digital|transformation|technology|it |information technology|enterprise architecture|systems/i.test(title)) {
        score += 35;
      }
    } else if (signalCategory === "hiring" || signalCategory === "company_expansion") {
      if (/engineering|talent|vp|cto|head of|director/i.test(title)) {
        score += 25;
      }
    }

    // 2. Seniority & Buying Role
    if (role === "economic_buyer" || role === "decision_maker") {
      score += 25;
    } else if (role === "technical_evaluator") {
      score += 20;
    } else if (role === "influencer") {
      score += 15;
    }

    if (/\b(?:chief|cto|cio|ciso|ceo|coo)\b/i.test(title)) {
      score += 30;
    } else if (/\b(?:vp|vice president)\b/i.test(title)) {
      score += 25;
    } else if (/\b(?:head of)\b/i.test(title)) {
      score += 20;
    } else if (/\b(?:director)\b/i.test(title)) {
      score += 15;
    } else if (/\b(?:manager|lead)\b/i.test(title)) {
      score += 10;
    }

    // 3. Channel bonus
    if (channel === "linkedin_note") {
      if (c.sourceNote && /linkedin\.com/i.test(c.sourceNote)) {
        score += 15;
      }
    } else if (channel === "email") {
      if (c.email) {
        score += 15;
      }
    }

    return { contact: c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.contact ?? null;
}

export type BusinessSignalType = "hiring" | "announcement" | "technology" | "general";

export type ExtractedSignal = {
  type: BusinessSignalType;
  role?: string;
  responsibilities?: string;
  focusArea?: string;
  summary: string;
  attribution: string;
  potentialBusinessImplication?: string;
  confidence?: number;
  relevanceScore?: number;
  verified?: boolean;
  sourceUrl?: string;
  sourceDate?: string | null;
  category?: string;
};

/**
 * Extracts a concise, factual business signal from evidence text rather than
 * dumping raw job descriptions or assuming unverified company expansion.
 *
 * Rules:
 * - Never treat a job posting as confirmation that a company is expanding.
 * - Never assume a new office, data center, or facility exists unless explicitly verified.
 * - Do not use ungrounded phrases like "scaling globally" or "launching a new site".
 */
export function extractBusinessSignal(params: {
  rawExcerpt?: string | null;
  sourceTitle?: string | null;
  publisher?: string | null;
  canonicalUrl?: string;
  companyName: string;
  offering?: string | null;
}): ExtractedSignal {
  const { rawExcerpt, sourceTitle, publisher, canonicalUrl, companyName, offering } = params;
  const attribution = sourceAttribution({ publisher, canonicalUrl });
  const cleanedText = cleanExcerpt(rawExcerpt, sourceTitle);

  if (!cleanedText) {
    return {
      type: "general",
      summary: `recent initiatives at ${companyName}`,
      attribution,
    };
  }

  // Check if source or excerpt points to a hiring / recruitment signal
  const isJobBoard =
    (canonicalUrl && /greenhouse\.io|lever\.co|workday|linkedin\.com\/jobs|careers|jobs\./i.test(canonicalUrl)) ||
    (publisher && /greenhouse|lever|workday|job board/i.test(publisher));

  const baseSignal: ExtractedSignal = (() => {
    // Pattern A: "As [Role], you will lead the teams that operate and evolve Graphcore's engineering labs, high-performance computing (HPC) platforms, and data center environments..."
    const roleLeadMatch = cleanedText.match(
      /As\s+([A-Za-z\s]+?),\s+you will (?:lead|drive|manage|oversee|scale|operate)\s+(?:the teams that operate and evolve )?(.*?)(?:\.|$)/i,
    );

    if (roleLeadMatch && roleLeadMatch[1] && roleLeadMatch[2]) {
      const role = roleLeadMatch[1].trim();
      let responsibilities = roleLeadMatch[2]
        .replace(new RegExp(`^${companyName}'s\\s+`, "i"), "")
        .replace(/^(the\s+)/i, "")
        .replace(/\s+globally\b/i, "") // Avoid unverified "globally" claims
        .replace(/data center environments?/i, "data centre operations")
        .trim();

      return {
        type: "hiring" as BusinessSignalType,
        role,
        responsibilities,
        focusArea: responsibilities,
        summary: responsibilities ? `hiring a ${role} for its ${responsibilities}` : `hiring for a ${role}`,
        attribution,
      };
    }

    // Pattern B: Job title in source title or "Seeking / Hiring a [Role] to [Objective]"
    const hiringMatch = cleanedText.match(
      /(?:seeking|hiring|recruiting|looking for)(?: a| an)?\s+([A-Za-z\s]+?)\s+to\s+(.*?)(?:\.|$)/i,
    );
    if (hiringMatch && hiringMatch[1] && hiringMatch[2]) {
      const role = hiringMatch[1].trim();
      const responsibilities = hiringMatch[2].trim();
      return {
        type: "hiring" as BusinessSignalType,
        role,
        responsibilities,
        focusArea: responsibilities,
        summary: `hiring a ${role}`,
        attribution,
      };
    }

    if (isJobBoard && sourceTitle) {
      const titleRole = sourceTitle
        .replace(/\s*-\s*(?:greenhouse|lever|jobs|careers).*/i, "")
        .replace(new RegExp(`\\s+(?:at|with)\\s+${companyName}.*`, "i"), "")
        .trim();

      if (titleRole) {
        return {
          type: "hiring" as BusinessSignalType,
          role: titleRole,
          responsibilities: "technical operations and infrastructure",
          focusArea: "technical operations and infrastructure",
          summary: `hiring a ${titleRole}`,
          attribution,
        };
      }
    }

    // Pattern C: Verified corporate announcement (e.g. facility or infrastructure project announcement)
    const announcementMatch = cleanedText.match(
      /(?:announced|announces|announcement regarding|unveiled|launched)\s+(.*?)(?:\.|$)/i,
    );
    if (announcementMatch && announcementMatch[1]) {
      const focusArea = announcementMatch[1]
        .replace(new RegExp(`^${companyName}'s?\\s+`, "i"), "")
        .replace(/^(?:its|their|a|an|the|recent)\s+/i, "")
        .replace(/^(?:recent)\s+/i, "")
        .trim();
      return {
        type: "announcement" as BusinessSignalType,
        focusArea,
        summary: `recent announcement regarding its ${focusArea}`,
        attribution,
      };
    }

    // Pattern D: Technology or research initiative
    const techMatch = cleanedText.match(
      /(?:work|initiative|deployment|project|collaboration)\s+(?:involving|around|on|with)\s+(.*?)(?:\.|$)/i,
    );
    if (techMatch && techMatch[1]) {
      const focus = techMatch[1].trim();
      return {
        type: "technology" as BusinessSignalType,
        focusArea: focus,
        summary: `recent work involving ${focus}`,
        attribution,
      };
    }

    // Fallback: Take first sentence cleanly
    const firstSentence = cleanedText.split(/[.!?]\s+/)[0] ?? cleanedText;
    const normalized = firstSentence
      .replace(new RegExp(`^${companyName}\\s+(?:today\\s+)?(?:announced|announces|reported|confirmed)\\s+(?:that\\s+)?`, "i"), "")
      .trim();

    return {
      type: "general" as BusinessSignalType,
      summary: normalized.charAt(0).toLowerCase() + normalized.slice(1),
      attribution,
    };
  })();

  // Enrich with Business Signal Intelligence Layer
  const intelligent = extractIntelligentSignal({
    companyName,
    rawExcerpt: rawExcerpt ?? undefined,
    sourceTitle: sourceTitle ?? undefined,
    publisher: publisher ?? undefined,
    canonicalUrl,
    offering,
  });

  return {
    ...baseSignal,
    potentialBusinessImplication: intelligent.potentialBusinessImplication,
    confidence: intelligent.confidence,
    relevanceScore: intelligent.relevanceScore,
    verified: intelligent.verified,
    sourceUrl: intelligent.sourceUrl,
    sourceDate: intelligent.sourceDate,
    category: intelligent.category,
  };
}

/**
 * Quality validation report for email drafts.
 */
export type DraftQualityReport = {
  valid: boolean;
  wordCount: number;
  issues: string[];
  warnings: string[];
  flaggedForReview: boolean;
};

/**
 * Validates outreach quality according to Section 8:
 * 1. Subject and body are not empty.
 * 2. Company name is correctly represented.
 * 3. Opening is supported by reviewed evidence.
 * 4. Evidence is summarized rather than copied excessively.
 * 5. No unsupported company expansion or infrastructure claims exist.
 * 6. Offering is relevant to the observed business signal.
 * 7. Discovery question matches the playbook.
 * 8. CTA is natural and non-aggressive.
 * 9. No invented contact information exists.
 * 10. Email is concise (approx 80–150 words) and free from scraping artifacts.
 */
export function validateDraftQuality(params: {
  subject: string;
  body: string;
  accountName: string;
  hasReviewedEvidence: boolean;
  signalType?: BusinessSignalType;
  channel?: string;
}): DraftQualityReport {
  const { subject, body, accountName, hasReviewedEvidence, signalType, channel = "email" } = params;
  const issues: string[] = [];
  const warnings: string[] = [];
  let flaggedForReview = false;

  // 1. Subject and body presence
  if (!subject || !subject.trim()) {
    issues.push("Subject line is missing.");
  }
  if (!body || !body.trim()) {
    issues.push("Message body is empty.");
    return { valid: false, wordCount: 0, issues, warnings, flaggedForReview: true };
  }

  // 2. Company name representation
  const lowerBody = body.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  const lowerCompany = accountName.toLowerCase();
  if (!lowerBody.includes(lowerCompany) && !lowerSubject.includes(lowerCompany)) {
    warnings.push("Company name is not explicitly mentioned in the subject or body.");
  }

  // 3 & 5. Unsupported expansion checks:
  // If the evidence was just a job posting, never claim ungrounded global scaling or new sites
  if (signalType === "hiring") {
    if (/\b(?:scaling globally|expanding across|opened a new site|launching a new facility)\b/i.test(body)) {
      issues.push("Job posting evidence does not support claims of 'scaling globally' or 'launching a new site'.");
    }
  }

  // 4 & 10. Artifacts and excessive verbatim quoting
  if (/https?:\/\//i.test(body)) {
    issues.push("Raw URLs found in email body. Sourced facts should cite publisher/attribution, not raw links.");
  }
  if (SCRAPE_BOILERPLATE_REGEX.test(body) || /the opportunity/i.test(body)) {
    issues.push("Job posting boilerplate ('The Opportunity') detected in email body.");
  }
  if (/with responsibilities spanning/i.test(body)) {
    issues.push("Job posting boilerplate ('with responsibilities spanning') detected in draft body.");
  }
  if (/<[^>]+>/.test(body)) {
    issues.push("HTML tags found in email body.");
  }

  // Check for excessively long quoted passages (> 160 characters in quotes)
  const quoteMatches = body.match(/"([^"]{160,})"/g);
  if (quoteMatches && quoteMatches.length > 0) {
    issues.push("Excessively long verbatim quotation found. Evidence should be summarized into a concise observation.");
  }

  // Word count check
  const words = body.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (channel === "email") {
    if (wordCount < 40) {
      issues.push(`Draft is too brief (${wordCount} words; minimum 40 words required).`);
    } else if (wordCount > 180) {
      warnings.push(`Draft length is ${wordCount} words; ideal cold outreach is between 90–140 words.`);
    }
  } else if (channel === "linkedin_note") {
    if (body.length > 300) {
      issues.push(`LinkedIn note exceeds 300 characters limit (${body.length} characters).`);
    }
  } else if (channel === "linkedin_inmail") {
    if (wordCount < 25) {
      issues.push(`LinkedIn InMail is too brief (${wordCount} words; minimum 25 words required).`);
    } else if (wordCount > 160) {
      warnings.push(`LinkedIn InMail length is ${wordCount} words; ideal InMail is between 50–120 words.`);
    }
  }

  // 8. CTA non-aggressive check
  if (/\b(urgent|act now|call me today|immediately|asap)\b/i.test(body)) {
    issues.push("Aggressive or forced sales language detected in call-to-action.");
  }

  // 9. Placeholder check (only {{first_name}} allowed)
  if (/\{\{(?!first_name\}\})[^}]+\}\}/.test(body)) {
    issues.push("Unresolved template placeholders detected in draft body.");
  }

  // Repetition check (duplicate sentences / paragraphs)
  const segments = body
    .split(/(?:[\r\n]+|[.!?]+(?:\s+|$))/)
    .map((s) => s.replace(/^(hi\s+(?:{{first_name}}|[a-z]+),?|best regards,?)/i, "").trim().toLowerCase())
    .filter((s) => s.length > 25);
  const seenSentences = new Set<string>();
  for (const s of segments) {
    if (seenSentences.has(s)) {
      issues.push(`Duplicate sentence detected: "${s.slice(0, 40)}…"`);
      break;
    }
    seenSentences.add(s);
  }

  // Insufficient evidence flag
  if (!hasReviewedEvidence) {
    flaggedForReview = true;
    warnings.push("Account has no reviewed evidence. Draft uses generalized outreach; review before sending.");
  }

  return {
    valid: issues.length === 0,
    wordCount,
    issues,
    warnings,
    flaggedForReview,
  };
}

/**
 * Formats a prospect's job title into a clean, conversational role focus clause.
 * e.g. "Head of Information Technology" -> "leading Information Technology"
 *      "Head of IT: Generation, Trading & Capital Projects" -> "leading IT for Generation, Trading & Capital Projects"
 *      "Head of Group IT Operations" -> "leading Group IT Operations"
 */
export function cleanTitleFocus(title?: string | null): string | null {
  if (!title) return null;
  const t = title.trim();
  if (!t || /^(unknown|n\/a|none|employee|contact)$/i.test(t)) return null;

  const cleaned = t.replace(/[,;]+$/, "");

  // Head of ...
  const headMatch = cleaned.match(/^head\s+of\s+(.+)$/i);
  if (headMatch && headMatch[1]) {
    const dept = headMatch[1].trim();
    if (dept.startsWith("IT:") || dept.startsWith("IT -")) {
      return `leading IT for ${dept.slice(3).trim()}`;
    }
    return `leading ${dept}`;
  }

  // VP / Vice President ...
  const vpMatch = cleaned.match(/^(?:vp|vice\s+president)(?:\s+of)?\s+(.+)$/i);
  if (vpMatch && vpMatch[1]) {
    return `leading ${vpMatch[1].trim()}`;
  }

  // Director of ...
  const dirMatch = cleaned.match(/^director(?:\s+of)?\s+(.+)$/i);
  if (dirMatch && dirMatch[1]) {
    return `directing ${dirMatch[1].trim()}`;
  }

  // Chief ... / C-level
  if (/\b(?:cio|cto|ciso|ceo|coo)\b/i.test(cleaned)) {
    return `as ${cleaned}`;
  }
  const chiefMatch = cleaned.match(/^chief\s+(.+)\s+officer$/i);
  if (chiefMatch && chiefMatch[1]) {
    return `as Chief ${chiefMatch[1]} Officer`;
  }

  // Lead / Manager ...
  const leadMatch = cleaned.match(/^(?:lead|manager)(?:\s+of)?\s+(.+)$/i);
  if (leadMatch && leadMatch[1]) {
    return `leading ${leadMatch[1].trim()}`;
  }
  const trailingManagerMatch = cleaned.match(/^(.+?)\s+(?:manager|lead)$/i);
  if (trailingManagerMatch && trailingManagerMatch[1]) {
    return `leading ${trailingManagerMatch[1].trim()}`;
  }

  return `in ${cleaned}`;
}

/**
 * Normalizes an observed fact or signal summary into a clean, grammatically sound clause.
 * Prevents awkward phrasing like "noticed Tract's acquires..." or "noticed Tract's is a...".
 */
export function formatSignalClause(accountName: string, raw?: string | null): string {
  if (!raw || !raw.trim()) return `recent work in the industry`;
  let s = raw.trim();

  // Strip markdown headers, bullets, and scraped prefixes
  s = s.replace(/^#+\s*/, "").replace(/^[-*•]\s*/, "");

  // Strip website/domain metadata
  s = s.replace(/^[A-Za-z0-9\s&.-]*(?:website|site|url|homepage|domain):\s*(?:https?:\/\/)?[\w.-]+\.[a-z]{2,}(?:\/\S*)?\s*/i, "");
  s = s.replace(/\b(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.(?:co\.uk|com|io|org|net|ai|eu|de|fr|info)\b/gi, "");

  // Strip leading company name variations
  s = s.replace(new RegExp(`^${accountName}(?:'s)?\\s+`, "i"), "");
  s = s.replace(new RegExp(`\\s+(?:at|for|with)\\s+${accountName}\\b`, "gi"), "");

  // Clean first-person promo phrasing
  s = s.replace(/^(?:at\s+[A-Za-z0-9\s&.-]+,\s*)?(?:we\s+(?:specialize|specialise)\s+in|we\s+provide|we\s+offer|we\s+are\s+(?:a|an)?|providing true value to our clients)\s+/i, "");

  // Deduplicate exact phrase repetitions like "infrastructure investment in infrastructure investment"
  s = s.replace(/\b([a-zA-Z\s]{4,})\s+in\s+\1\b/gi, "$1");
  s = s.replace(/\b([a-zA-Z\s]{4,})\s+and\s+\1\b/gi, "$1");

  // Normalize leading verbs into noun or gerund phrases
  if (/^is\s+a\s+/i.test(s)) {
    s = s.replace(/^is\s+a\s+/i, "work as a ");
  } else if (/^is\s+an\s+/i.test(s)) {
    s = s.replace(/^is\s+an\s+/i, "work as an ");
  } else if (/^is\s+expanding\s+/i.test(s)) {
    s = s.replace(/^is\s+expanding\s+/i, "expansion in ");
  } else if (/^is\s+/i.test(s)) {
    s = s.replace(/^is\s+/i, "work in ");
  } else if (/^(?:announced|announces)\s+/i.test(s)) {
    s = s.replace(/^(?:announced|announces)\s+/i, "announcement regarding ");
  } else if (/^(?:acquired|acquires)\s+/i.test(s)) {
    s = s.replace(/^(?:acquired|acquires)\s+/i, "acquisition of ");
  } else if (/^(?:developed|develops)\s+/i.test(s)) {
    s = s.replace(/^(?:developed|develops)\s+/i, "development of ");
  } else if (/^(?:launched|launches)\s+/i.test(s)) {
    s = s.replace(/^(?:launched|launches)\s+/i, "launch of ");
  }

  s = s.replace(/[.,;]+$/, "").trim();

  if (/^(?:recent initiatives|bespoke solutions|true value|our clients|solutions and embrace)/i.test(s) || s.length < 10) {
    s = "recent strategic initiatives";
  }

  return s;
}

/**
 * Produces punchy, mobile-optimized B2B connection bridges tailored to each account.
 * Calibrated specifically for the 180–220 character sweet spot recommended for executive B2B outreach.
 */
function buildLinkedInBridge(accountName: string, offering?: string | null, openingLen = 70): string {
  const clean = offering?.trim();
  const lower = clean ? clean.toLowerCase() : "";
  const targetMax = 225; // Target sweet spot ceiling: ~180-220 characters
  const remaining = Math.max(35, targetMax - openingLen);

  // Deterministic variation per account so each company gets a distinct, natural voice
  const hash = accountName.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const variant = hash % 3;

  let fullCandidates: string[] = [];

  if (/recruitment|staffing|talent/i.test(lower)) {
    fullCandidates = [
      `We partner with engineering leaders on specialized technical talent — would love to connect and exchange notes.`,
      `We work alongside technical leaders to help scale engineering teams. Would love to connect and exchange perspectives.`,
      `We support growing technical teams with specialist recruitment — would love to connect here and follow your journey.`,
    ];
  } else if (/compute|server|infrastructure|cloud hosting|data cent(?:er|re)|hpc/i.test(lower)) {
    fullCandidates = [
      `We partner with technical teams on ${lower} to support reliable operations. Would love to connect and share notes.`,
      `We work alongside engineering leaders on ${lower}. Would love to connect and exchange perspectives.`,
      `We support infrastructure teams with ${lower} — would love to connect here and follow your journey.`,
    ];
  } else if (lower) {
    fullCandidates = [
      `We partner with growing teams on ${lower}. Would love to connect and exchange perspectives.`,
      `We work alongside leaders on ${lower} to help execute roadmaps. Would love to connect and share notes.`,
      `We support innovative teams with ${lower} — would love to connect here and follow your journey as you scale.`,
    ];
  } else {
    fullCandidates = [
      `Always keen to connect with leaders at ${accountName} to exchange perspectives and follow your journey.`,
      `Would love to connect here and follow your journey as ${accountName} continues to grow.`,
      `We partner with growing organizations — would love to connect and exchange perspectives.`,
    ];
  }

  const chosenFull = fullCandidates[variant] ?? fullCandidates[0]!;
  if (chosenFull.length <= remaining) {
    return chosenFull;
  }

  // Medium / compact candidates (~70-90 chars) when opening is medium-long
  const mediumCandidates = [
    clean ? `We partner with teams on ${lower} — would love to connect and exchange notes.` : `Would love to connect here and exchange notes on your roadmap.`,
    clean ? `We support technical teams with ${lower} — would love to connect and share perspectives.` : `Would love to connect here and follow your journey at ${accountName}.`,
    clean ? `We work with leaders on ${lower} — would love to connect and follow your journey.` : `Would love to connect and exchange perspectives.`,
  ];

  const chosenMedium = mediumCandidates[variant] ?? mediumCandidates[0]!;
  if (chosenMedium.length <= remaining) {
    return chosenMedium;
  }

  // Short candidates (~40-60 chars) when opening is very long
  const shortCandidates = [
    clean ? `Would love to connect and exchange notes on ${lower}.` : `Would love to connect and exchange notes.`,
    clean ? `Would love to connect and share perspectives on ${lower}.` : `Would love to connect and share perspectives.`,
    clean ? `Would love to connect and follow your journey at ${accountName}.` : `Would love to connect here.`,
  ];

  const chosenShort = shortCandidates[variant] ?? shortCandidates[0]!;
  if (chosenShort.length <= remaining) {
    return chosenShort;
  }

  return clean ? `Would love to connect on ${lower}.` : `Would love to connect here.`;
}

/**
 * Builds conversational, context-aware B2B outreach content following Section 6:
 *
 * Subject: Relevant offering + company name
 *
 * Hi {{first_name}},
 *
 * 1. Personalized opening based on verified evidence.
 * 2. Brief explanation of why the observed activity may create a relevant business consideration.
 * 3. Connection to the workspace offering.
 * 4. One contextual discovery question.
 * 5. Short, low-pressure CTA.
 *
 * Best regards,
 */
export function buildDraftContent(params: {
  accountName: string;
  offering?: string | null;
  channel?: string;
  signal?: ExtractedSignal | null;
  actionableHypotheses: Array<{ fieldKey: string; value: string }>;
  discoveryQuestion?: string | null;
  recipientName?: string | null;
  recipientTitle?: string | null;
  sellerContext?: SellerContext | null;
  hasReviewedEvidence?: boolean;
}): { subject: string; body: string } {
  const {
    accountName,
    offering,
    channel = "email",
    signal,
    actionableHypotheses,
    discoveryQuestion,
    recipientName,
    recipientTitle,
    sellerContext,
    hasReviewedEvidence,
  } = params;

  const cleanOffering = (sellerContext?.sellerOffering || offering)?.trim();
  const firstName = extractFirstName(recipientName);
  const roleFocus = cleanTitleFocus(recipientTitle);
  const sellerCompany = sellerContext?.sellerCompany?.trim();
  const authorName = sellerContext?.authorName?.trim();

  // If evidence review gate fails: clean skeleton with clear notice
  if (hasReviewedEvidence === false) {
    const subject = `Draft (Pending Evidence Review) · ${accountName}`;
    const signOffLines = ["Best,"];
    if (authorName) {
      signOffLines.push(authorName);
      if (sellerCompany) signOffLines.push(sellerCompany);
    } else if (sellerCompany) {
      signOffLines.push(sellerCompany);
    } else {
      signOffLines.push("[Your Name]");
    }
    const body = [
      `Hi ${firstName},`,
      ``,
      `[Evidence review pending: This account does not have reviewed evidence yet. Please review the cited evidence in the Account Brief before sending outreach.]`,
      ``,
      `We partner with engineering teams on ${cleanOffering || "managed infrastructure"} to support growing compute requirements and streamline operations.`,
      ``,
      `Would you be open to a brief 10-minute conversation next week to exchange perspectives?`,
      ``,
      signOffLines.join("\n"),
    ].join("\n");
    return { subject, body };
  }

  // LinkedIn Note: calibrated for executive sweet spot (~180-220 characters, max 300)
  // Strictly two sentences, signal stays with company
  if (channel === "linkedin_note") {
    const subject = `Connection request: ${accountName}`;
    const signalClause = formatSignalClause(accountName, signal?.summary);
    const hasSignal = Boolean(signal?.summary && signalClause !== "recent work in the industry");

    let opening: string;
    if (signal?.type === "hiring" && signal.role) {
      const focus = signal.focusArea ? ` for its ${signal.focusArea}` : "";
      if (roleFocus) {
        opening = `Hi ${firstName}, noticed your work ${roleFocus} at ${accountName}, and saw ${accountName} is hiring a ${signal.role}${focus}.`;
      } else {
        opening = `Hi ${firstName}, noticed ${accountName}'s hiring for a ${signal.role}${focus}.`;
      }
    } else if (roleFocus && hasSignal) {
      opening = `Hi ${firstName}, noticed your work ${roleFocus} at ${accountName}, and ${accountName}'s ${signalClause}.`;
    } else if (roleFocus) {
      opening = `Hi ${firstName}, noticed your work ${roleFocus} at ${accountName}.`;
    } else if (hasSignal) {
      opening = `Hi ${firstName}, noticed ${accountName}'s ${signalClause}.`;
    } else {
      opening = `Hi ${firstName}, noticed ${accountName}'s recent work in the industry.`;
    }

    const bridge = buildLinkedInBridge(accountName, cleanOffering, opening.length);
    let body = `${opening} ${bridge}`;

    if (body.length > 295) {
      const maxOpeningLen = Math.max(35, 290 - bridge.length - 1);
      const truncatedOpening = opening.slice(0, maxOpeningLen).replace(/\s+\S*$/, "") + "…";
      body = `${truncatedOpening} ${bridge}`;
    }

    if (body.length > 300) {
      body = body.slice(0, 296).replace(/\s+\S*$/, "") + "…";
    }

    return { subject, body };
  }

  // Call script: structured phone talk track
  if (channel === "call_script") {
    const offerCat = detectOfferingCategory(cleanOffering);
    const subject = `Call script: ${accountName}`;
    const triggerText = roleFocus
      ? `your work ${roleFocus} at ${accountName}`
      : signal?.summary ?? "your recent initiatives in operations";

    const callerCompany = sellerCompany || "[Company]";
    const callerName = authorName || "[Your Name]";

    const valueProp = (() => {
      const prefix = sellerCompany ? `"At ${sellerCompany}, we` : `"We`;
      if (offerCat === "recruitment") {
        return cleanOffering
          ? `${prefix} partner with leaders on ${cleanOffering.toLowerCase()} to help source specialist talent and scale technical teams efficiently."`
          : `${prefix} partner with leaders on specialist recruitment to help scale technical teams efficiently."`;
      }
      if (offerCat === "software") {
        return cleanOffering
          ? `${prefix} work with engineering and product teams on ${cleanOffering.toLowerCase()} to help build and modernize critical systems."`
          : `${prefix} partner with teams on software solutions to help modernize critical systems."`;
      }
      if (offerCat === "services") {
        return cleanOffering
          ? `${prefix} partner with organizations on ${cleanOffering.toLowerCase()} to help execute on strategic priorities and streamline operations."`
          : `${prefix} partner with organizations on professional services to help streamline operations."`;
      }
      if (offerCat === "infrastructure") {
        return cleanOffering
          ? `${prefix} work with engineering teams on ${cleanOffering.toLowerCase()} to support growing compute requirements and streamline operations."`
          : `${prefix} partner with engineering teams to support infrastructure requirements and streamline operations."`;
      }
      return cleanOffering
        ? `${prefix} work with organizations on ${cleanOffering.toLowerCase()} to support operational execution and achieve key milestones."`
        : `${prefix} partner with organizations to support key operational initiatives and growth milestones."`;
    })();

    const scriptQuestion = (() => {
      if (signal?.type === "hiring" && signal.role) {
        return `"Is the ${signal.role} hire looking to replace someone, or are you building out a new team for this?"`;
      }
      if (discoveryQuestion && !/will the site use local compute/i.test(discoveryQuestion)) {
        return `"${discoveryQuestion}"`;
      }
      if (offerCat === "recruitment") {
        return `"As you scale out these initiatives, are you looking to bring in specialist engineering talent externally, or handling it in-house?"`;
      }
      if (offerCat === "software") {
        return `"As you advance these technical initiatives, are you building in-house or evaluating external software partners?"`;
      }
      if (offerCat === "services") {
        return `"As you plan for these upcoming milestones, is this an active focus area for your leadership team over the coming quarters?"`;
      }
      if (offerCat === "infrastructure") {
        return `"${discoveryQuestion || "Are you currently evaluating local compute, centralized infrastructure, or cloud-based solutions for your engineering workloads?"}"`;
      }
      return `"As you look ahead to your next stage of growth, is this an active focus area for your team?"`;
    })();

    const scriptCta = offerCat === "recruitment"
      ? `"Would you be open to a brief 10-minute conversation next week to exchange perspectives on technical hiring and team scaling?"`
      : offerCat === "software"
        ? `"Would you be open to a brief 10-minute conversation next week to exchange perspectives on your technical roadmap?"`
        : offerCat === "infrastructure"
          ? `"Would you be open to a brief 10-minute conversation next week to exchange perspectives on infrastructure requirements?"`
          : `"Would you be open to a brief 10-minute conversation next week to exchange perspectives and share notes?"`;

    const body = [
      `[Goal: Secure a 10-minute introductory conversation]`,
      ``,
      `1. Opening:`,
      `"Hi ${firstName}, this is ${callerName} with ${callerCompany}. I know I caught you out of the blue — do you have 30 seconds?"`,
      ``,
      `2. Context & Sourced Trigger:`,
      `"The reason for my call: I came across ${triggerText}, and wanted to reach out directly."`,
      ``,
      `3. Value Proposition:`,
      valueProp,
      ``,
      `4. Discovery Question:`,
      scriptQuestion,
      ``,
      `5. Closing Call-to-Action:`,
      scriptCta,
    ].join("\n");
    return { subject, body };
  }

  const offerCat = detectOfferingCategory(cleanOffering);

  // Trigger-centric subject line
  const subject = (() => {
    if (signal?.type === "hiring" && signal.role) {
      return `${signal.role} role · ${accountName}`;
    }
    if (cleanOffering) {
      return `${cleanOffering} · ${accountName}`;
    }
    if (signal?.type === "announcement" && signal.focusArea) {
      const fa = signal.focusArea.charAt(0).toUpperCase() + signal.focusArea.slice(1);
      return `${fa} · ${accountName}`;
    }
    if (signal?.type === "technology" && signal.focusArea) {
      const fa = signal.focusArea.charAt(0).toUpperCase() + signal.focusArea.slice(1);
      return `${fa} · ${accountName}`;
    }
    return `Exploring potential partnership · ${accountName}`;
  })();

  // 1. Personalized opening based on verified evidence with publisher & timing
  const timing = formatSignalTiming(signal?.sourceDate);
  const pub = signal?.attribution ? signal.attribution : null;

  const opening = (() => {
    const roleClause = roleFocus ? ` and came across your work ${roleFocus}` : "";

    if (signal?.type === "hiring") {
      const focusDesc = signal.focusArea ? ` for its ${signal.focusArea}` : "";
      if (pub && timing) {
        return `I saw on ${pub} ${timing} that ${accountName} is hiring a ${signal.role}${focusDesc}${roleClause}.`;
      }
      if (pub) {
        return `I saw on ${pub} that ${accountName} is hiring a ${signal.role}${focusDesc}${roleClause}.`;
      }
      if (timing) {
        return `I saw ${timing} that ${accountName} is hiring a ${signal.role}${focusDesc}${roleClause}.`;
      }
      return `I came across ${accountName}'s hiring for a ${signal.role}${focusDesc}${roleClause}.`;
    }

    if (signal?.type === "announcement") {
      if (pub && timing) {
        return `I saw on ${pub} ${timing} that ${accountName} announced its ${signal.focusArea || "infrastructure expansion"}${roleClause}.`;
      }
      if (pub) {
        return `I saw on ${pub} that ${accountName} announced its ${signal.focusArea || "infrastructure expansion"}${roleClause}.`;
      }
      return `I noticed ${accountName}'s ${signal.summary}${roleClause}.`;
    }

    if (signal?.type === "technology") {
      if (pub) {
        return `I saw on ${pub} details regarding ${accountName}'s work involving ${signal.focusArea || "infrastructure"}${roleClause}.`;
      }
      return `I came across ${accountName}'s work involving ${signal.focusArea || "technology initiatives"}${roleClause}.`;
    }

    const signalClause = formatSignalClause(accountName, signal?.summary);
    const isSpecificSignal =
      Boolean(signal?.summary) &&
      signal?.category !== "general" &&
      signalClause !== "recent strategic initiatives" &&
      signalClause !== "recent work in the industry";

    if (isSpecificSignal) {
      if (pub) {
        return `I saw on ${pub} details regarding ${accountName}'s ${signalClause}${roleClause}.`;
      }
      return `I noticed ${accountName}'s ${signalClause}${roleClause}.`;
    }

    if (roleFocus) {
      return `I've been following ${accountName}'s recent initiatives and came across your work ${roleFocus}.`;
    }
    return `I've been following ${accountName}'s recent initiatives and work in your space.`;
  })();

  // 2. Brief explanation of why the observed activity creates a relevant business consideration
  const consideration = (() => {
    if (offerCat === "recruitment") {
      if (
        signal?.potentialBusinessImplication &&
        !/compute density|server capacity|server availability|compute consumption/i.test(signal.potentialBusinessImplication)
      ) {
        return signal.potentialBusinessImplication;
      }
      if (signal?.type === "hiring" || signal?.category === "hiring") {
        return `As technical hiring demands accelerate, securing specialized engineering talent quickly without overstretching in-house recruitment capacity is critical.`;
      }
      if (signal?.category === "company_expansion" || signal?.category === "infrastructure_investment") {
        return `Scaling high-performance infrastructure and delivering on major expansion plans requires having the right specialist engineering talent in place to hit key milestones without overstretching core teams.`;
      }
      return `As operational demands and technical requirements scale, having the right specialist talent in place is essential to hit key milestones without overstretching internal teams.`;
    }
    if (signal?.potentialBusinessImplication) {
      return signal.potentialBusinessImplication;
    }
    if (offerCat === "software") {
      return `Modernizing core systems and delivering on key developments requires scalable software architecture and automated workflows to maintain performance.`;
    }
    if (offerCat === "services" || offerCat === "general") {
      return `As major strategic developments and expansions take shape, maintaining operational stability and managing organizational capacity become essential.`;
    }
    if (signal?.type === "hiring" || (signal?.responsibilities && /hpc|labs?|compute|data centre|data center/i.test(signal.responsibilities))) {
      return `As these environments evolve, maintaining reliable infrastructure and ensuring server capacity can scale efficiently become increasingly important.`;
    }
    if (signal?.type === "announcement") {
      return `As key infrastructure developments take shape, maintaining operational stability while balancing capacity and performance is critical.`;
    }
    return `As technical requirements evolve, maintaining reliable infrastructure and keeping operational overhead streamlined become essential.`;
  })();

  // 3. Connection to the workspace offering (grounded in seller context)
  const weClause = sellerCompany ? `At ${sellerCompany}, we` : "We";
  const offeringConnection = (() => {
    if (offerCat === "recruitment") {
      const lowerOffer = cleanOffering ? cleanOffering.toLowerCase() : "specialist technology recruitment";
      return `${weClause} partner with engineering and technical leaders on ${lowerOffer} to help source and place specialized talent when scaling key initiatives.`;
    }
    if (offerCat === "software") {
      const lowerOffer = cleanOffering ? cleanOffering.toLowerCase() : "software solutions";
      return `${weClause} work with engineering and product teams on ${lowerOffer} to help build, scale, and modernize critical capabilities.`;
    }
    if (offerCat === "services") {
      const lowerOffer = cleanOffering ? cleanOffering.toLowerCase() : "professional services";
      return `${weClause} partner with organizations on ${lowerOffer} to help execute on strategic priorities and streamline operational workflows.`;
    }
    if (offerCat === "infrastructure") {
      const lowerOffer = cleanOffering ? cleanOffering.toLowerCase() : "infrastructure solutions";
      return `${weClause} work with engineering teams on ${lowerOffer} to support growing compute requirements and streamline operations.`;
    }
    if (cleanOffering) {
      return `${weClause} partner with organizations on ${cleanOffering.toLowerCase()} to support key operational initiatives and growth milestones.`;
    }
    return `${weClause} partner with organizations to support key operational initiatives and growth milestones.`;
  })();

  // 4. Contextual discovery question (earned questions, never raw hypothesis keys)
  const question = (() => {
    if (signal?.type === "hiring" && signal.role) {
      return `Is the ${signal.role} hire looking to replace someone, or are you building out a new team for this?`;
    }

    if (actionableHypotheses.length > 0) {
      const firstHypo = actionableHypotheses[0]!;
      const val = firstHypo.value.trim();
      if (offerCat === "recruitment") {
        return `Are you currently looking to bring in specialist talent in this area, or managing requirements with internal resources?`;
      }
      if (offerCat === "software") {
        return `Are you developing these capabilities in-house or evaluating external software partners?`;
      }
      if (offerCat === "infrastructure") {
        return `Are you currently standardizing on ${val}, or evaluating alternative approaches for your engineering workloads?`;
      }
      return `Is this currently an active focus area for your team?`;
    }

    // Adapt playbook question cleanly without assuming an ungrounded "new site"
    if (discoveryQuestion?.trim()) {
      const q = discoveryQuestion.trim();
      if (/will the site use local compute/i.test(q)) {
        if (offerCat === "recruitment") {
          if (signal?.type === "hiring" || signal?.category === "hiring") {
            return `Which technical roles or skill sets are proving most critical to fill as you expand the team?`;
          }
          if (signal?.category === "company_expansion" || signal?.category === "infrastructure_investment") {
            return `As you ramp up this expansion, are you planning to bring in specialist talent to support the deployment, or is your current engineering team handling it in-house?`;
          }
          return `As you plan across your upcoming technical priorities, are you looking to bring in specialist talent externally, or handling requirements with internal resources?`;
        }
        if (offerCat === "software") {
          return `As you advance these technical initiatives, are you building capabilities in-house or evaluating external software partners?`;
        }
        if (offerCat === "services" || offerCat === "general") {
          return `As you plan for these upcoming milestones, is this an active focus area for your leadership team over the coming quarters?`;
        }
        return `Are you currently evaluating local compute, centralized infrastructure, or cloud-based solutions for your engineering workloads?`;
      }
      return q;
    }

    if (offerCat === "recruitment") {
      if (signal?.type === "hiring" || signal?.category === "hiring") {
        return `Which technical roles or skill sets are proving most critical to fill as you expand the team?`;
      }
      if (signal?.category === "company_expansion" || signal?.category === "infrastructure_investment") {
        return `As you ramp up this expansion, are you planning to bring in specialist talent to support the deployment, or is your current engineering team handling it in-house?`;
      }
      return `As you plan across your upcoming technical priorities, are you looking to bring in specialist talent externally, or handling requirements with internal resources?`;
    }
    if (offerCat === "software") {
      return `As you advance these technical initiatives, are you building capabilities in-house or evaluating external software partners?`;
    }
    if (offerCat === "services" || offerCat === "general") {
      return `As you plan for these upcoming milestones, is this an active focus area for your leadership team over the coming quarters?`;
    }

    return `Are you currently evaluating local compute, centralized infrastructure, or cloud-based solutions for your engineering workloads?`;
  })();

  // LinkedIn InMail channel
  if (channel === "linkedin_inmail") {
    const authorFirstName = authorName ? extractFirstName(authorName) : "";
    const inmailBody = [
      `Hi ${firstName},`,
      ``,
      opening,
      ``,
      consideration,
      ``,
      offeringConnection,
      ``,
      question,
      ``,
      `Would you be open to connecting briefly to exchange perspectives?`,
      ...(authorFirstName ? [``, `— ${authorFirstName}`] : []),
    ].join("\n");
    return { subject, body: inmailBody };
  }

  // 5. Short, low-pressure CTA
  const cta = (() => {
    if (offerCat === "recruitment") {
      return `Would you be open to a brief 10-minute conversation next week to exchange perspectives on technical hiring and team scaling?`;
    }
    if (offerCat === "software") {
      return `Would you be open to a brief 10-minute conversation next week to exchange perspectives on your technical roadmap?`;
    }
    if (offerCat === "services") {
      return `Would you be open to a brief 10-minute conversation next week to exchange perspectives and share notes?`;
    }
    if (offerCat === "infrastructure") {
      return `Would you be open to a brief 10-minute conversation next week to exchange perspectives on infrastructure requirements?`;
    }
    return `Would you be open to a brief 10-minute conversation next week to exchange perspectives and share notes?`;
  })();

  // Sign-off with author's name and seller company
  const signOffLines = ["Best,"];
  if (authorName) {
    signOffLines.push(authorName);
    if (sellerCompany) signOffLines.push(sellerCompany);
  } else if (sellerCompany) {
    signOffLines.push(sellerCompany);
  } else {
    signOffLines.push("[Your Name]");
  }

  const body = [
    `Hi ${firstName},`,
    ``,
    opening,
    ``,
    consideration,
    ``,
    offeringConnection,
    ``,
    question,
    ``,
    cta,
    ``,
    signOffLines.join("\n"),
  ].join("\n");

  return { subject, body };
}

/**
 * Reviewable draft from offer context and cited, reviewed facts (R8). Hypotheses
 * are listed separately in metadata, unknowns stay unknown, and no contact details are generated.
 * Creating a draft never dispatches anything.
 */
export async function createDraft(input: {
  tenantId: string;
  workspaceId: string;
  accountId: string;
  channel?: string;
  authorUserId: string;
  subject?: string;
  bodyEdits?: string;
  contactId?: string;
}) {
  const db = getDb();
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.workspaceId, input.workspaceId)))
    .limit(1);
  if (!account) throw notFound("Account not found");

  const [offer] = await db
    .select()
    .from(offers)
    .where(eq(offers.workspaceId, input.workspaceId))
    .limit(1);
  const windowDays = offer?.eventWindowDays ?? 90;

  // Gate drafts strictly on reviewed evidence; never silently fall back to unreviewed scrape dumps
  const evRows = await db
    .select({ evidence, source: sources })
    .from(evidence)
    .innerJoin(sources, eq(evidence.sourceId, sources.id))
    .where(
      and(
        eq(evidence.accountId, input.accountId),
        eq(evidence.workspaceId, input.workspaceId),
        isNotNull(evidence.reviewedAt),
      ),
    )
    .orderBy(desc(evidence.eventDate))
    .limit(5);

  const hasReviewedEvidence = evRows.length > 0;

  const [qual] = await db
    .select()
    .from(qualifications)
    .where(and(eq(qualifications.accountId, input.accountId), eq(qualifications.workspaceId, input.workspaceId)))
    .limit(1);

  const qualFacts = qual
    ? await db
        .select()
        .from(qualificationFacts)
        .where(
          and(
            eq(qualificationFacts.qualificationId, qual.id),
            isNull(qualificationFacts.supersededBy),
            eq(qualificationFacts.basis, "research_hypothesis"),
          ),
        )
    : [];

  const hypotheses = qualFacts.map((f) => `${f.fieldKey.replace(/_/g, " ")}: ${f.value ?? "unknown"}`);

  // Actionable hypotheses have known, estimated values to confirm (excluding "unknown", "n/a", etc.)
  const actionableHypotheses = qualFacts
    .filter(
      (f) =>
        Boolean(f.value) &&
        !["unknown", "n/a", "none", "tbd", "unspecified"].includes(f.value!.toLowerCase().trim()),
    )
    .map((f) => ({ fieldKey: f.fieldKey, value: f.value! }));

  // Retrieve playbook discovery question:
  // First priority: Originating playbook from the search run that found this company or evidence
  let originatingPlaybook: PlaybookView | null = null;
  const runIdFromEvidence = evRows.find((e) => Boolean(e.evidence.researchRunId))?.evidence.researchRunId;
  if (runIdFromEvidence) {
    const [evRun] = await db
      .select({ playbookVersionId: researchRuns.playbookVersionId })
      .from(researchRuns)
      .where(
        and(
          eq(researchRuns.id, runIdFromEvidence),
          eq(researchRuns.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (evRun?.playbookVersionId) {
      originatingPlaybook = await getPlaybookVersion(input.workspaceId, evRun.playbookVersionId);
    }
  }

  // If not found from evidence, check direct research runs for this account
  if (!originatingPlaybook) {
    const [accRun] = await db
      .select({ playbookVersionId: researchRuns.playbookVersionId })
      .from(researchRuns)
      .where(
        and(
          eq(researchRuns.accountId, input.accountId),
          eq(researchRuns.workspaceId, input.workspaceId),
          isNotNull(researchRuns.playbookVersionId),
        ),
      )
      .orderBy(desc(researchRuns.createdAt))
      .limit(1);
    if (accRun?.playbookVersionId) {
      originatingPlaybook = await getPlaybookVersion(input.workspaceId, accRun.playbookVersionId);
    }
  }

  let discoveryQuestion: string | null = originatingPlaybook?.rules.discoveryQuestion ?? null;

  // Second priority / Fallback: Workspace's default active playbook
  if (!discoveryQuestion) {
    const offerCat = detectOfferingCategory(offer?.offering);
    let playbookKey = offer?.activePlaybookTemplateKey ?? "infrastructure";
    if (playbookKey === "infrastructure" && offerCat === "recruitment") {
      playbookKey = "recruitment";
    }
    try {
      const custom = await latestPlaybook(input.workspaceId, playbookKey);
      discoveryQuestion = custom?.rules.discoveryQuestion ?? null;
    } catch {
      // ignore
    }
    if (!discoveryQuestion) {
      const builtIn = BUILT_IN_PLAYBOOKS.find((p) => p.templateKey === playbookKey);
      discoveryQuestion = builtIn?.rules.discoveryQuestion ?? null;
    }
  }

  const stale = evRows.some((e) => evidenceFreshness(e.evidence, windowDays) === "stale") ? 1 : 0;

  // Extract and rank business signals using the Signal Intelligence Layer
  let signal: ExtractedSignal | null = null;
  if (evRows.length > 0) {
    const rawInputs: RawEvidenceInput[] = evRows.map((e) => ({
      companyName: account.name,
      rawExcerpt: e.evidence.excerpt,
      sourceTitle: e.source.title,
      publisher: e.source.publisher,
      canonicalUrl: e.source.canonicalUrl,
      eventDate: e.evidence.eventDate ? String(e.evidence.eventDate) : undefined,
      discoveredAt: e.evidence.discoveredAt ? String(e.evidence.discoveredAt) : undefined,
      reviewedAt: e.evidence.reviewedAt ? String(e.evidence.reviewedAt) : undefined,
    }));

    const deduped = deduplicateEvidence(rawInputs);
    const ranked = rankEvidence(deduped, offer?.offering);
    const topItem = ranked[0];

    if (topItem) {
      signal = extractBusinessSignal({
        rawExcerpt: topItem.rawInput.rawExcerpt,
        sourceTitle: topItem.rawInput.sourceTitle,
        publisher: topItem.rawInput.publisher,
        canonicalUrl: topItem.rawInput.canonicalUrl,
        companyName: account.name,
        offering: offer?.offering,
      });
      if (topItem.signal.observedFact) {
        signal.summary = topItem.signal.observedFact;
      }
      signal.potentialBusinessImplication = topItem.signal.potentialBusinessImplication;
      signal.confidence = topItem.signal.confidence;
      signal.relevanceScore = topItem.signal.relevanceScore;
      signal.verified = topItem.signal.verified;
      signal.category = topItem.signal.category;
      signal.sourceDate = topItem.signal.sourceDate;
    }
  }

  // Intelligently select or match target contact for personalized outreach
  const peopleResult = await listPeople({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    accountId: input.accountId,
  }).catch(() => ({ contacts: [], roleHypotheses: [] }));

  let chosenContact: ContactCandidate | null = null;
  if (input.contactId) {
    chosenContact = peopleResult.contacts.find((c) => c.id === input.contactId) ?? null;
    if (!chosenContact) {
      const [directContact] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, input.contactId), eq(contacts.workspaceId, input.workspaceId)))
        .limit(1);
      if (directContact) {
        chosenContact = directContact;
      }
    }
  }
  if (!chosenContact && peopleResult.contacts.length > 0) {
    chosenContact = rankContactsForSignal(peopleResult.contacts, signal?.category, input.channel ?? "email", offer?.offering);
  }

  const [authorUser] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, input.authorUserId))
    .limit(1);

  const sellerContext: SellerContext = {
    sellerCompany: offer?.sellerCompany,
    sellerOffering: offer?.offering,
    authorName: authorUser?.name,
  };

  const generated = buildDraftContent({
    accountName: account.name,
    offering: offer?.offering,
    channel: input.channel ?? "email",
    signal,
    actionableHypotheses,
    discoveryQuestion,
    recipientName: chosenContact?.name,
    recipientTitle: chosenContact?.title,
    sellerContext,
    hasReviewedEvidence,
  });

  const subject = input.subject ?? generated.subject;
  const body = input.bodyEdits ?? generated.body;

  // Run pre-save quality validation
  const quality = validateDraftQuality({
    subject,
    body,
    accountName: account.name,
    hasReviewedEvidence,
    signalType: signal?.type,
    channel: input.channel ?? "email",
  });

  if (!quality.valid) {
    throw validationError(`Draft quality validation failed: ${quality.issues.join("; ")}`);
  }

  const contactId = chosenContact?.id ?? input.contactId ?? null;
  const id = newId("dft");
  await db.insert(drafts).values({
    id,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    accountId: input.accountId,
    contactId,
    channel: input.channel ?? "email",
    subject,
    body,
    evidenceIdsJson: JSON.stringify(evRows.map((e) => e.evidence.id)),
    hypothesesJson: JSON.stringify(hypotheses),
    staleWarning: stale,
    authorUserId: input.authorUserId,
  });

  const [row] = await db.select().from(drafts).where(eq(drafts.id, id)).limit(1);
  return row!;
}

export async function listDrafts(tenantId: string, workspaceId: string, accountIds?: string[], accountId?: string) {
  const db = getDb();
  const rows = await db
    .select({ draft: drafts, accountName: accounts.name })
    .from(drafts)
    .innerJoin(accounts, eq(drafts.accountId, accounts.id))
    .where(and(eq(drafts.workspaceId, workspaceId), eq(drafts.tenantId, tenantId)))
    .orderBy(desc(drafts.updatedAt));
  return rows
    .filter((r) => (accountId ? r.draft.accountId === accountId : true))
    .filter((r) => (accountIds ? accountIds.includes(r.draft.accountId) : true))
    .map((r) => ({ ...r.draft, accountName: r.accountName }));
}

export async function getDraft(tenantId: string, workspaceId: string, draftId: string) {
  const db = getDb();
  const [d] = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, draftId), eq(drafts.workspaceId, workspaceId), eq(drafts.tenantId, tenantId)))
    .limit(1);
  if (!d) throw notFound("Draft not found");
  return d;
}

export async function updateDraft(input: {
  tenantId: string;
  workspaceId: string;
  draftId: string;
  subject?: string;
  body?: string;
  expectedVersion: number;
}) {
  const db = getDb();
  const d = await getDraft(input.tenantId, input.workspaceId, input.draftId);
  // Edits are preserved as the current version; any edit requires fresh review
  const updated = await db
    .update(drafts)
    .set({
      subject: input.subject ?? d.subject,
      body: input.body ?? d.body,
      version: d.version + 1,
      approvedAt: null,
      approvedBy: null,
      updatedAt: new Date(),
    })
    .where(and(eq(drafts.id, d.id), eq(drafts.version, input.expectedVersion)))
    .returning();
  if (!updated[0]) throw conflict("Draft changed by someone else — reload and retry");
  return updated[0];
}

export async function approveDraft(input: {
  tenantId: string;
  workspaceId: string;
  draftId: string;
  expectedVersion: number;
  actorUserId: string;
}) {
  const db = getDb();
  const d = await getDraft(input.tenantId, input.workspaceId, input.draftId);
  if (/\{\{(?!first_name\}\})[^}]+\}\}/.test(d.body)) {
    throw validationError("Resolve template placeholders before approving");
  }
  const updated = await db
    .update(drafts)
    .set({ approvedAt: new Date(), approvedBy: input.actorUserId })
    .where(and(eq(drafts.id, d.id), eq(drafts.version, input.expectedVersion)))
    .returning();
  if (!updated[0]) throw conflict("Draft changed since you reviewed it — reload and retry");
  await writeAudit({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "draft.approved",
    entityType: "draft",
    entityId: d.id,
    metadata: { version: d.version },
  });
  return updated[0];
}

export async function deleteDraft(input: {
  tenantId: string;
  workspaceId: string;
  draftId: string;
  actorUserId: string;
}) {
  const db = getDb();
  const d = await getDraft(input.tenantId, input.workspaceId, input.draftId);
  await db
    .delete(drafts)
    .where(
      and(
        eq(drafts.id, input.draftId),
        eq(drafts.workspaceId, input.workspaceId),
        eq(drafts.tenantId, input.tenantId),
      ),
    );

  await writeAudit({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "draft.deleted",
    entityType: "draft",
    entityId: d.id,
    metadata: { accountId: d.accountId, channel: d.channel },
  });

  return { success: true };
}

export async function regenerateDraft(input: {
  tenantId: string;
  workspaceId: string;
  draftId: string;
  actorUserId: string;
}) {
  const db = getDb();
  const existing = await getDraft(input.tenantId, input.workspaceId, input.draftId);

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, existing.accountId), eq(accounts.workspaceId, input.workspaceId)))
    .limit(1);
  if (!account) throw notFound("Account not found");

  const [offer] = await db
    .select()
    .from(offers)
    .where(eq(offers.workspaceId, input.workspaceId))
    .limit(1);
  const windowDays = offer?.eventWindowDays ?? 90;

  // Gate drafts strictly on reviewed evidence
  const evRows = await db
    .select({ evidence, source: sources })
    .from(evidence)
    .innerJoin(sources, eq(evidence.sourceId, sources.id))
    .where(
      and(
        eq(evidence.accountId, existing.accountId),
        eq(evidence.workspaceId, input.workspaceId),
        isNotNull(evidence.reviewedAt),
      ),
    )
    .orderBy(desc(evidence.eventDate))
    .limit(5);

  const hasReviewedEvidence = evRows.length > 0;

  const [qual] = await db
    .select()
    .from(qualifications)
    .where(and(eq(qualifications.accountId, existing.accountId), eq(qualifications.workspaceId, input.workspaceId)))
    .limit(1);

  const qualFacts = qual
    ? await db
        .select()
        .from(qualificationFacts)
        .where(
          and(
            eq(qualificationFacts.qualificationId, qual.id),
            isNull(qualificationFacts.supersededBy),
            eq(qualificationFacts.basis, "research_hypothesis"),
          ),
        )
    : [];

  const hypotheses = qualFacts.map((f) => `${f.fieldKey.replace(/_/g, " ")}: ${f.value ?? "unknown"}`);
  const actionableHypotheses = qualFacts
    .filter(
      (f) =>
        Boolean(f.value) &&
        !["unknown", "n/a", "none", "tbd", "unspecified"].includes(f.value!.toLowerCase().trim()),
    )
    .map((f) => ({ fieldKey: f.fieldKey, value: f.value! }));

  // Extract signal
  let signal: ExtractedSignal | null = null;
  if (evRows.length > 0) {
    const rawInputs: RawEvidenceInput[] = evRows.map((e) => ({
      companyName: account.name,
      rawExcerpt: e.evidence.excerpt,
      sourceTitle: e.source.title,
      publisher: e.source.publisher,
      canonicalUrl: e.source.canonicalUrl,
      eventDate: e.evidence.eventDate ? String(e.evidence.eventDate) : undefined,
      discoveredAt: e.evidence.discoveredAt ? String(e.evidence.discoveredAt) : undefined,
      reviewedAt: e.evidence.reviewedAt ? String(e.evidence.reviewedAt) : undefined,
    }));

    const deduped = deduplicateEvidence(rawInputs);
    const ranked = rankEvidence(deduped, offer?.offering);
    const topItem = ranked[0];

    if (topItem) {
      signal = extractBusinessSignal({
        rawExcerpt: topItem.rawInput.rawExcerpt,
        sourceTitle: topItem.rawInput.sourceTitle,
        publisher: topItem.rawInput.publisher,
        canonicalUrl: topItem.rawInput.canonicalUrl,
        companyName: account.name,
        offering: offer?.offering,
      });
      if (topItem.signal.observedFact) {
        signal.summary = topItem.signal.observedFact;
      }
      signal.potentialBusinessImplication = topItem.signal.potentialBusinessImplication;
      signal.confidence = topItem.signal.confidence;
      signal.relevanceScore = topItem.signal.relevanceScore;
      signal.verified = topItem.signal.verified;
      signal.category = topItem.signal.category;
      signal.sourceDate = topItem.signal.sourceDate;
    }
  }

  // Preserve target contact across regeneration; never swap contacts
  let chosenContact: ContactCandidate | null = null;
  if (existing.contactId) {
    const [savedContact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, existing.contactId), eq(contacts.workspaceId, input.workspaceId)))
      .limit(1);
    if (savedContact) {
      chosenContact = savedContact;
    }
  }
  if (!chosenContact) {
    const peopleResult = await listPeople({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      accountId: existing.accountId,
    }).catch(() => ({ contacts: [], roleHypotheses: [] }));

    if (peopleResult.contacts.length > 0) {
      chosenContact = rankContactsForSignal(peopleResult.contacts, signal?.category, existing.channel, offer?.offering);
    }
  }

  // Retrieve playbook discovery question
  let originatingPlaybook: PlaybookView | null = null;
  const runIdFromEvidence = evRows.find((e) => Boolean(e.evidence.researchRunId))?.evidence.researchRunId;
  if (runIdFromEvidence) {
    const [evRun] = await db
      .select({ playbookVersionId: researchRuns.playbookVersionId })
      .from(researchRuns)
      .where(and(eq(researchRuns.id, runIdFromEvidence), eq(researchRuns.workspaceId, input.workspaceId)))
      .limit(1);
    if (evRun?.playbookVersionId) {
      originatingPlaybook = await getPlaybookVersion(input.workspaceId, evRun.playbookVersionId);
    }
  }
  let discoveryQuestion: string | null = originatingPlaybook?.rules.discoveryQuestion ?? null;
  if (!discoveryQuestion) {
    const offerCat = detectOfferingCategory(offer?.offering);
    let playbookKey = offer?.activePlaybookTemplateKey ?? "infrastructure";
    if (playbookKey === "infrastructure" && offerCat === "recruitment") {
      playbookKey = "recruitment";
    }
    try {
      const custom = await latestPlaybook(input.workspaceId, playbookKey);
      discoveryQuestion = custom?.rules.discoveryQuestion ?? null;
    } catch {
      // ignore
    }
    if (!discoveryQuestion) {
      const builtIn = BUILT_IN_PLAYBOOKS.find((p) => p.templateKey === playbookKey);
      discoveryQuestion = builtIn?.rules.discoveryQuestion ?? null;
    }
  }

  const [authorUser] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, input.actorUserId))
    .limit(1);

  const sellerContext: SellerContext = {
    sellerCompany: offer?.sellerCompany,
    sellerOffering: offer?.offering,
    authorName: authorUser?.name,
  };

  const generated = buildDraftContent({
    accountName: account.name,
    offering: offer?.offering,
    channel: existing.channel,
    signal,
    actionableHypotheses,
    discoveryQuestion,
    recipientName: chosenContact?.name,
    recipientTitle: chosenContact?.title,
    sellerContext,
    hasReviewedEvidence,
  });

  // Enforce quality validation on regeneration as well
  const quality = validateDraftQuality({
    subject: generated.subject,
    body: generated.body,
    accountName: account.name,
    hasReviewedEvidence,
    signalType: signal?.type,
    channel: existing.channel,
  });

  if (!quality.valid) {
    throw validationError(`Draft quality validation failed: ${quality.issues.join("; ")}`);
  }

  const stale = evRows.some((e) => evidenceFreshness(e.evidence, windowDays) === "stale") ? 1 : 0;

  const [updated] = await db
    .update(drafts)
    .set({
      subject: generated.subject,
      body: generated.body,
      contactId: chosenContact?.id ?? existing.contactId ?? null,
      evidenceIdsJson: JSON.stringify(evRows.map((e) => e.evidence.id)),
      hypothesesJson: JSON.stringify(hypotheses),
      staleWarning: stale,
      version: existing.version + 1,
      approvedAt: null,
      approvedBy: null,
      updatedAt: new Date(),
    })
    .where(and(eq(drafts.id, existing.id), eq(drafts.workspaceId, input.workspaceId)))
    .returning();

  await writeAudit({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "draft.regenerated",
    entityType: "draft",
    entityId: existing.id,
    metadata: { accountId: existing.accountId, channel: existing.channel, version: updated?.version },
  });

  return updated!;
}
