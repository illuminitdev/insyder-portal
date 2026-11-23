import type { NormalizedEvidenceItem, ResearchFilters } from "../providers/research/types.js";
import { hostnameOf, normalizeDomain } from "../utils/normalize.js";

/**
 * Provider-neutral hints feeding scoreEvidence(): how well a signal matches what
 * the run asked for (fit) and how trustworthy its publisher is (quality).
 * Heuristics only — every input is observable on the item; nothing is guessed.
 */

const KNOWN_SIGNAL_KINDS = new Set([
  "expansion",
  "infra_hiring",
  "refresh",
  "compute",
  "procurement",
  "cloud_migration",
  "leadership_change",
  "technology_adoption",
  "infrastructure_investment",
  "digital_transformation",
  "funding",
  "m_and_a",
  "security_compliance",
  "cost_optimization",
]);

/** Publisher tiers, matched against the source host and its parent domains. */
const OFFICIAL_RECORDS = [
  "find-tender.service.gov.uk",
  "contractsfinder.service.gov.uk",
  "ted.europa.eu",
  "sam.gov",
  "companieshouse.gov.uk",
  "sec.gov",
];
const MAJOR_NEWS = [
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "bbc.co.uk",
  "bbc.com",
  "theguardian.com",
  "cnbc.com",
  "forbes.com",
  "nytimes.com",
  "economist.com",
  "apnews.com",
  "irishtimes.com",
  "handelsblatt.com",
  "lesechos.fr",
];
const TRADE_PRESS = [
  "datacenterdynamics.com",
  "datacenterknowledge.com",
  "theregister.com",
  "computerweekly.com",
  "techtarget.com",
  "zdnet.com",
  "networkworld.com",
  "capacitymedia.com",
  "techcrunch.com",
  "siliconrepublic.com",
  "crn.com",
  "itpro.com",
  "computing.co.uk",
  "datacentremagazine.com",
];
const PRESS_WIRES = ["prnewswire.com", "businesswire.com", "globenewswire.com", "accesswire.com", "newswire.com"];
const JOB_BOARDS = [
  "linkedin.com",
  "indeed.com",
  "indeed.co.uk",
  "glassdoor.com",
  "glassdoor.co.uk",
  "reed.co.uk",
  "totaljobs.com",
  "monster.com",
  "cwjobs.co.uk",
  "irishjobs.ie",
];
const DIRECTORIES = [
  "leadiq.com",
  "zoominfo.com",
  "crunchbase.com",
  "apollo.io",
  "rocketreach.co",
  "owler.com",
  "dnb.com",
  "craft.co",
  "cbinsights.com",
  "globalmspdirectory.com",
  "yell.com",
  "endole.co.uk",
  "companycheck.co.uk",
  "opencorporates.com",
];
const USER_CONTENT = [
  "medium.com",
  "substack.com",
  "blogspot.com",
  "wordpress.com",
  "reddit.com",
  "quora.com",
  "tumblr.com",
  "youtube.com",
  "facebook.com",
  "x.com",
  "twitter.com",
];

export const QUALITY = {
  firstParty: 90,
  official: 90,
  majorNews: 85,
  tradePress: 75,
  pressWire: 70,
  jobBoard: 65,
  unknown: 55,
  userContent: 35,
} as const;

function onDomain(host: string, domains: readonly string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** True for news sites, wires, job boards and social/blog hosts — publishers, not companies. */
export function isKnownPublisher(host: string): boolean {
  return [OFFICIAL_RECORDS, MAJOR_NEWS, TRADE_PRESS, PRESS_WIRES, JOB_BOARDS, DIRECTORIES, USER_CONTENT].some((list) =>
    onDomain(host, list),
  );
}

/** Publisher trust: the company's own site and official records rank highest, blogs lowest. */
export function sourceQualityHint(url: string, companyWebsite?: string | null): number {
  const host = hostnameOf(url);
  if (!host) return QUALITY.unknown;
  const company = normalizeDomain(companyWebsite);
  if (company && (host === company || host.endsWith(`.${company}`))) return QUALITY.firstParty;
  if (onDomain(host, OFFICIAL_RECORDS) || /\.gov(\.[a-z]{2})?$/.test(host)) return QUALITY.official;
  if (onDomain(host, MAJOR_NEWS)) return QUALITY.majorNews;
  if (onDomain(host, TRADE_PRESS)) return QUALITY.tradePress;
  if (onDomain(host, PRESS_WIRES)) return QUALITY.pressWire;
  if (onDomain(host, JOB_BOARDS)) return QUALITY.jobBoard;
  if (onDomain(host, DIRECTORIES) || onDomain(host, USER_CONTENT)) return QUALITY.userContent;
  return QUALITY.unknown;
}

const STOPWORDS = new Set(["and", "the", "for", "with", "services", "service", "industry", "sector", "other"]);

/** True when the item's text mentions one of the industries (phrase, or a distinctive word of it). */
export function mentionsIndustry(item: NormalizedEvidenceItem, industries: readonly string[]): boolean {
  const text = [item.title, item.excerpt, item.subject?.eventSummary].filter(Boolean).join(" ").toLowerCase();
  if (!text) return false;
  return industries.some((raw) => {
    const phrase = raw.toLowerCase().replace(/[_-]+/g, " ").trim();
    if (!phrase) return false;
    if (text.includes(phrase)) return true;
    return phrase
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 5 && !STOPWORDS.has(w))
      .some((w) => text.includes(w));
  });
}

/**
 * Fit 0–100 from four observable checks:
 *   base 30
 *   signal type   +20 selected kind or a list item meeting every criterion
 *                 (+15 any known kind when none selected, +5 known but not selected)
 *   country       +15 matches the filter (+5 unknown country, +10 when no country filter)
 *   industry      +15 text mentions a target industry (+8 when no industry filter)
 *   identity      +15 company and website identified (+7 name only, +7 account-mode research)
 */
export function fitHint(item: NormalizedEvidenceItem, filters: ResearchFilters = {}): number {
  let fit = 30;

  const kind = item.signalKind ?? "";
  if (kind === "webset_match") {
    fit += 20; // every list criterion (incl. the signal) checked with cited sources
  } else if (KNOWN_SIGNAL_KINDS.has(kind) || kind.startsWith("custom_")) {
    if (!filters.signalKinds?.length) fit += 15;
    else fit += filters.signalKinds.includes(kind) ? 20 : 5;
  }

  if (filters.countries?.length) {
    if (!item.country) fit += 5;
    else if (filters.countries.includes(item.country)) fit += 15;
  } else {
    fit += 10;
  }

  if (filters.industries?.length) {
    if (mentionsIndustry(item, filters.industries)) fit += 15;
  } else {
    fit += 8;
  }

  if (!item.subject) fit += 7; // account mode: the company is already known
  else if (item.subject.companyName && item.subject.companyWebsite) fit += 15;
  else if (item.subject.companyName || item.subject.companyWebsite) fit += 7;

  return Math.min(100, Math.max(0, fit));
}

/** Attach fit and quality hints to normalized items. */
export function withScoringHints(items: NormalizedEvidenceItem[], filters: ResearchFilters = {}): NormalizedEvidenceItem[] {
  return items.map((item) => ({
    ...item,
    fitHint: fitHint(item, filters),
    // The researched account's own domain counts as first-party too
    qualityHint: sourceQualityHint(item.canonicalUrl, item.subject?.companyWebsite ?? filters.companyDomain),
  }));
}
