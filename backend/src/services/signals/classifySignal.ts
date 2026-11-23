import { cleanExcerpt, sourceAttribution } from "../drafts.js";
import type { BusinessSignalCategory, RawEvidenceInput } from "./types.js";
import { detectOfferingCategory } from "./buildBusinessContext.js";

export interface ClassifiedSignalData {
  category: BusinessSignalCategory;
  role?: string;
  responsibilities?: string;
  focusArea?: string;
  rawSummary: string;
  attribution: string;
}

/**
 * Classifies an evidence snippet into one of 8 structured business signal categories.
 * Accepts an optional offering so job-board fallback responsibilities stay domain-neutral.
 */
export function classifySignal(input: RawEvidenceInput & { offering?: string | null }): ClassifiedSignalData {
  const { rawExcerpt, sourceTitle, publisher, canonicalUrl, companyName, offering } = input;
  const attribution = sourceAttribution({ publisher, canonicalUrl });
  const cleanedText = cleanExcerpt(rawExcerpt, sourceTitle);
  const combined = `${sourceTitle ?? ""} ${cleanedText}`.trim();
  const offerCat = detectOfferingCategory(offering);

  const isJobBoard =
    (canonicalUrl && /greenhouse\.io|lever\.co|workday|linkedin\.com\/jobs|careers|jobs\./i.test(canonicalUrl)) ||
    (publisher && /greenhouse|lever|workday|job board/i.test(publisher));

  // --- Category 1: Cloud Migration ---
  if (
    /\b(?:cloud (?:migration|transformation|shift|strategy|adoption)|migrat(?:ing|ed|ion) to (?:aws|azure|gcp|google cloud|cloud)|cloud-native architecture|modernizing to cloud)\b/i.test(
      combined,
    )
  ) {
    const cloudMatch = combined.match(/\b(aws|azure|gcp|google cloud|cloud-native|hybrid cloud)\b/i);
    const provider = cloudMatch ? cloudMatch[1] : "cloud";
    return {
      category: "cloud_migration",
      focusArea: `${provider} infrastructure migration`,
      rawSummary: `active cloud migration and infrastructure modernization initiatives`,
      attribution,
    };
  }

  // --- Category 2: Leadership Changes (Executive appointments) ---
  const execMatch = combined.match(
    /\b(?:appointed|names?|hires?|welcomes?|joined as|promotes?)\s+((?:(?:Dr|Prof|Mr|Ms|Mrs)\.?\s+)?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(?:as|to the role of)\s+(?:the\s+)?(Chief [A-Za-z]+ Officer|CTO|CIO|CISO|VP of [A-Za-z\s]+|Head of [A-Za-z\s]+|Director of [A-Za-z\s]+)/i,
  );
  if (execMatch && execMatch[1] && execMatch[2]) {
    const person = execMatch[1].trim();
    const execRole = execMatch[2].trim();
    return {
      category: "leadership_change",
      role: execRole,
      focusArea: person,
      rawSummary: `appointment of ${person} as ${execRole}`,
      attribution,
    };
  }

  // --- Category 3: Hiring (Engineering & Leadership roles) ---
  // Pattern A: "As [Role], you will lead the teams that operate and evolve Graphcore's engineering labs, high-performance computing (HPC) platforms, and data center environments..."
  const roleLeadMatch = cleanedText.match(
    /As\s+([A-Za-z\s]+?),\s+you will (?:lead|drive|manage|oversee|scale|operate)\s+(?:the teams that operate and evolve )?(.*?)(?:\.|$)/i,
  );
  if (roleLeadMatch && roleLeadMatch[1] && roleLeadMatch[2]) {
    const role = roleLeadMatch[1].trim();
    let responsibilities = roleLeadMatch[2]
      .replace(new RegExp(`^${companyName}'s\\s+`, "i"), "")
      .replace(/^(the\s+)/i, "")
      .replace(/\s+globally\b/i, "")
      .replace(/data center environments?/i, "data centre operations")
      .trim();

    return {
      category: "hiring",
      role,
      responsibilities,
      rawSummary: `hiring for a ${role}, with responsibilities spanning ${responsibilities}`,
      attribution,
    };
  }

  // Pattern B: "Seeking / hiring a [Role] to [Objective]"
  const hiringMatch = cleanedText.match(
    /(?:seeking|hiring|recruiting|looking for)(?: a| an)?\s+([A-Za-z\s]+?)\s+to\s+(.*?)(?:\.|$)/i,
  );
  if (hiringMatch && hiringMatch[1] && hiringMatch[2]) {
    const role = hiringMatch[1].trim();
    const responsibilities = hiringMatch[2].trim();
    return {
      category: "hiring",
      role,
      responsibilities,
      rawSummary: `hiring for a ${role}, with responsibilities spanning ${responsibilities}`,
      attribution,
    };
  }

  if (isJobBoard && sourceTitle) {
    const titleRole = sourceTitle
      .replace(/\s*-\s*(?:greenhouse|lever|jobs|careers).*/i, "")
      .replace(new RegExp(`\\s+(?:at|with)\\s+${companyName}.*`, "i"), "")
      .trim();

    if (titleRole) {
      // Derive a domain-neutral responsibilities hint based on the offering category
      const jobFallbackResponsibilities =
        offerCat === "recruitment"
          ? "talent acquisition and specialist hiring"
          : offerCat === "software"
            ? "product development and engineering operations"
            : offerCat === "services"
              ? "client delivery and operational execution"
              : "technical operations";

      return {
        category: "hiring",
        role: titleRole,
        responsibilities: jobFallbackResponsibilities,
        rawSummary: `hiring for a ${titleRole}`,
        attribution,
      };
    }
  }

  // --- Category 4: Infrastructure Investment ---
  // Requires an actual investment, development, or announcement action, not merely the words "data centre" in a company name
  const hasInfraAction =
    /\b(?:announced|announces|announcement|unveiled|launched|investing in|invests in|invested|breaks ground|breaking ground|building|expanding|expansion of|opened|opening|developing|development of|facility build)\b/i.test(
      combined,
    );
  const hasInfraKeyword =
    /\b(?:data cent(?:er|re)s?|server clusters?|high-performance computing|hpc platforms?|compute facility|infrastructure expansion|hardware deployment)\b/i.test(
      combined,
    );

  if (hasInfraAction && hasInfraKeyword) {
    const infraMatch = combined.match(
      /(?:announced|announces|unveiled|launched|investing in|invests in|building|expanding|opened)\s+(?:its\s+)?(.*?)(?:\.|$)/i,
    );
    const rawFocus = infraMatch && infraMatch[1] ? infraMatch[1].trim() : "";
    const focus = rawFocus && !/^(its\s+)?infrastructure\s*(investment)?$/i.test(rawFocus)
      ? rawFocus
      : "compute capability expansion";
    return {
      category: "infrastructure_investment",
      focusArea: focus,
      rawSummary: `infrastructure investment and compute capability expansion`,
      attribution,
    };
  }

  // --- Category 5: Digital Transformation ---
  if (
    /\b(?:digital transformation|modernizing legacy|core systems overhaul|automating operations|workflow modernization)\b/i.test(
      combined,
    )
  ) {
    return {
      category: "digital_transformation",
      focusArea: "enterprise digital transformation",
      rawSummary: `digital transformation and operations modernization`,
      attribution,
    };
  }

  // --- Category 6: Company Expansion (Funding, M&A, scale) ---
  if (
    /\b(?:series [a-z]|seed round|raised £?\d+[mk]?|raised \$?\d+[mk]?|merg(?:ed|ing|er)|acquir(?:ed|ing|ition)|expanded into|new office in)\b/i.test(
      combined,
    )
  ) {
    const mAndAMatch = combined.match(/(?:merg(?:ed|ing|er) with|acquir(?:ed|ing|ition) of)\s+([A-Za-z0-9\s&]+)/i);
    const fundingMatch = combined.match(/(?:raised|secures?)\s+(\$?\£?\d+(?:\.\d+)?\s*[MKmk]?(?:\s*million)?)/i);
    const focus = mAndAMatch ? `merger with ${mAndAMatch[1].trim()}` : fundingMatch ? `recent funding round of ${fundingMatch[1]}` : "business expansion";
    return {
      category: "company_expansion",
      focusArea: focus,
      rawSummary: `strategic expansion and ${focus}`,
      attribution,
    };
  }

  // --- Category 7: Technology Adoption ---
  const techMatch = cleanedText.match(
    /(?:work|initiative|deployment|project|collaboration)\s+(?:involving|around|on|with)\s+(.*?)(?:\.|$)/i,
  );
  if (techMatch && techMatch[1]) {
    const focus = techMatch[1].trim();
    return {
      category: "technology_adoption",
      focusArea: focus,
      rawSummary: `recent work involving ${focus}`,
      attribution,
    };
  }

  // --- Category 8: General Corporate Announcement ---
  const announcementMatch = cleanedText.match(
    /(?:announced|announces|announcement regarding|unveiled|launched)\s+(.*?)(?:\.|$)/i,
  );
  if (announcementMatch && announcementMatch[1]) {
    const focusArea = announcementMatch[1]
      .replace(new RegExp(`^${companyName}'s?\\s+`, "i"), "")
      .replace(/^(?:its|their|a|an|the|recent)\s+/i, "")
      .trim();
    return {
      category: "general",
      focusArea,
      rawSummary: `recent announcement regarding its ${focusArea}`,
      attribution,
    };
  }

  // Fallback: General Business Initiative
  const firstSentence = cleanedText.split(/[.!?]\s+/)[0] ?? cleanedText;
  let normalized = firstSentence
    .replace(new RegExp(`^${companyName}\\s+(?:today\\s+)?(?:announced|announces|reported|confirmed)\\s+(?:that\\s+)?`, "i"), "")
    .replace(/^[A-Za-z0-9\s&.-]*(?:website|site|url|homepage|domain):\s*(?:https?:\/\/)?[\w.-]+\.[a-z]{2,}(?:\/\S*)?\s*/i, "")
    .trim();

  // If the fallback is website marketing copy or fluff rather than an actual event
  if (
    !normalized ||
    /^(?:bespoke solutions|specializ|true value|our clients|leading provider|providing true value|work in bespoke)/i.test(normalized) ||
    normalized.length < 8
  ) {
    normalized = "recent strategic initiatives";
  }

  return {
    category: "general",
    rawSummary: normalized ? normalized.charAt(0).toLowerCase() + normalized.slice(1) : `recent initiatives at ${companyName}`,
    attribution,
  };
}
