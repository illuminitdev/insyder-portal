import { getResearchProvider } from "../providers/research/index.js";
import { companyDomain, companyNameKey } from "../utils/normalize.js";

/**
 * Research sometimes names a company only through a news article, job post or tender listing, so
 * the account has no website. These helpers (1) find the company's own website by its name, and
 * (2) recognise "names" that are really tender or job-ad titles, so they don't become accounts.
 */

/** Words too common to identify a company on their own */
const GENERIC = new Set([
  "the", "and", "of", "for", "group", "company", "services", "service", "solutions", "systems", "system",
  "technology", "technologies", "tech", "global", "international", "national", "hospital", "health",
  "healthcare", "university", "college", "school", "bank", "partners", "consulting", "holdings", "uk",
  "us", "usa", "india", "europe", "digital", "network", "networks", "software", "it", "data", "cloud",
]);

function tokens(s: string) {
  return companyNameKey(s).split(" ").filter((t) => t.length >= 3 || /^\d+$/.test(t));
}

/**
 * Whether a website candidate belongs to the company: the domain must carry the name (all
 * distinctive words, or the name's initials), or the page title must name the company.
 */
export function websiteMatchesCompany(name: string, url: string, title: string | null): boolean {
  const domain = companyDomain(url);
  if (!domain) return false;
  const all = tokens(name);
  if (!all.length) return false;
  const distinctive = all.filter((t) => !GENERIC.has(t));

  // Domain without www and the TLD ("www.mobility.siemens.com" → "mobilitysiemens", "thechange.co.uk" → "thechange")
  const parts = domain.split(".").filter((p) => p !== "www");
  parts.pop();
  if (parts.length > 1 && parts[parts.length - 1]!.length <= 3 && /^(co|com|org|net|ac|gov|ltd|plc|edu)$/.test(parts[parts.length - 1]!)) parts.pop();
  const label = parts.join("").replace(/-/g, "");
  if (!label) return false;

  // A word "hits" the domain whole, or by its first 5 letters for long words ("rehabilitation" → "rehab")
  const pieces = (t: string) => (t.length >= 6 ? [t, t.slice(0, 5)] : [t]);
  const hit = (t: string) => pieces(t).some((p) => label.includes(p));
  if (!(distinctive.length ? distinctive : all).some(hit)) return false;

  // The domain is made of the company's words: removing them leaves almost nothing
  // (rejects "bostonglobe" for "Boston Hospital Group", "premierhealth" for "Premier Systems")
  let rest = label;
  for (const t of [...all].sort((a, b) => b.length - a.length)) {
    for (const p of pieces(t)) rest = rest.replace(p, "");
  }
  if (rest.length <= 3) return true;

  // Initials: "Spaulding Rehabilitation Hospital" → "srh…"
  const initials = all.map((t) => t[0]).join("");
  if (all.length >= 3 && label.startsWith(initials) && label.length <= initials.length + 3) return true;
  return false;
}

/** The company's own domain found by name, or null when no candidate clearly belongs to it. Never throws. */
export async function findCompanyDomain(name: string, country?: string | null): Promise<string | null> {
  if (!name || looksLikeNotACompany(name)) return null;
  try {
    const provider = getResearchProvider();
    if (!provider.findCompanyWebsites) return null;
    const candidates = await provider.findCompanyWebsites({ name, country });
    const hit = candidates.find((c) => websiteMatchesCompany(name, c.url, c.title));
    return hit ? companyDomain(hit.url) : null;
  } catch {
    return null;
  }
}

const TENDER_START =
  /^(selection of|supply(ing)? of|supply and|procurement of|provision of|hiring of|engagement of|empanelment of|appointment of|request for|rfp\b|rfq\b|rfi\b|eoi\b|expression of interest|invitation (for|to)|notice inviting|tender\b|e-?tender|bid (for|to)|bids for|design,? supply|installation of|implementation of|construction of|operation (and|&) maintenance)/i;
const TENDER_WORDS = /\b(tender|bid(s|ding)?|rfp|rfq|eoi|nit|procurement|empanelment|consumables|supply,? installation)\b/i;
const JOB_WORDS =
  /\b(hiring|vacanc(y|ies)|job (opening|post)|career(s)? at|we'?re hiring|apply now|(senior |junior )?(sales development representative|account executive|sales engineer|software engineer|business development (manager|executive)))\b/i;

/** True when a research "company name" is really a tender, procurement notice or job-ad title */
export function looksLikeNotACompany(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (TENDER_START.test(n)) return true;
  if (JOB_WORDS.test(n)) return true;
  const words = n.split(/\s+/).length;
  if (n.length > 90 || words > 12) return true;
  if (words > 6 && TENDER_WORDS.test(n)) return true;
  return false;
}
