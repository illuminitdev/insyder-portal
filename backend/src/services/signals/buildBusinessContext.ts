import type { BusinessSignalCategory } from "./types.js";
import type { ClassifiedSignalData } from "./classifySignal.js";

/**
 * Classifies an offering string into its primary business model domain.
 * Defaults to "infrastructure" when empty for backward compatibility with existing tests.
 */
export function detectOfferingCategory(offering?: string | null): "recruitment" | "infrastructure" | "software" | "services" | "general" {
  if (!offering || !offering.trim()) return "infrastructure";
  const o = offering.toLowerCase();
  if (/(?:recruitment|staffing|talent|search|headhunt|hiring|workforce|placement|executive search)/i.test(o)) {
    return "recruitment";
  }
  if (/(?:software|saas|app|platform|development|devops|cybersecurity|security|qa|testing)/i.test(o)) {
    return "software";
  }
  if (/(?:compute|server|infrastructure|cloud hosting|data cent(?:er|re)|hpc|network|storage|hardware|colocation)/i.test(o)) {
    return "infrastructure";
  }
  if (/(?:consulting|advisory|agency|marketing|advertising|pr|legal|law firm|accounting|audit|finance|financial advisory|logistics)/i.test(o)) {
    return "services";
  }
  return "general";
}

/**
 * Builds the natural observed fact and operational business implication for a classified signal.
 */
export function buildBusinessContext(params: {
  companyName: string;
  classification: ClassifiedSignalData;
  offering?: string | null;
}): { observedFact: string; potentialBusinessImplication: string } {
  const { companyName, classification, offering } = params;
  const { category, role, responsibilities, focusArea, rawSummary } = classification;
  const offerCategory = detectOfferingCategory(offering);

  // 1. Natural Observed Fact Formulation
  let observedFact = "";
  switch (category) {
    case "hiring": {
      if (role && responsibilities) {
        observedFact = `hiring for a ${role}, with responsibilities spanning ${responsibilities}`;
      } else if (role) {
        observedFact = `hiring for a ${role}`;
      } else {
        observedFact = rawSummary;
      }
      break;
    }
    case "leadership_change": {
      observedFact = rawSummary;
      break;
    }
    case "cloud_migration": {
      observedFact = focusArea || `cloud migration and infrastructure modernization initiatives`;
      break;
    }
    case "infrastructure_investment": {
      if (focusArea && !/^(its\s+)?infrastructure(\s+investment)?$/i.test(focusArea.trim())) {
        observedFact = `infrastructure investment in ${focusArea}`;
      } else {
        observedFact = `infrastructure investment and compute capability expansion`;
      }
      break;
    }
    case "digital_transformation": {
      observedFact = `digital transformation and core systems modernization`;
      break;
    }
    case "company_expansion": {
      observedFact = focusArea ? `strategic expansion and ${focusArea}` : `strategic company expansion`;
      break;
    }
    case "technology_adoption": {
      observedFact = focusArea ? `recent work involving ${focusArea}` : rawSummary;
      break;
    }
    default: {
      observedFact = rawSummary;
      break;
    }
  }

  // 2. Concrete Potential Business Implication (adapted to offering domain)
  let potentialBusinessImplication = "";

  if (offerCategory === "recruitment") {
    switch (category) {
      case "hiring": {
        potentialBusinessImplication = `As technical hiring demands accelerate, securing specialized engineering talent quickly without overstretching in-house recruitment capacity is critical.`;
        break;
      }
      case "infrastructure_investment":
      case "company_expansion": {
        potentialBusinessImplication = `Scaling high-performance infrastructure and executing major expansions requires having the right specialist engineering talent in place to hit key milestones without overstretching core teams.`;
        break;
      }
      case "cloud_migration":
      case "digital_transformation":
      case "technology_adoption": {
        potentialBusinessImplication = `Delivering on complex technical migrations and modernization initiatives hinges on securing specialized engineering expertise to ensure seamless execution and avoid project delays.`;
        break;
      }
      case "leadership_change": {
        potentialBusinessImplication = `Executive transitions often lead to team restructuring and an immediate focus on recruiting senior technical leaders to deliver on updated roadmaps.`;
        break;
      }
      default: {
        potentialBusinessImplication = `As operational demands and technical requirements scale, having the right specialist talent in place is essential to hit key milestones without overstretching internal teams.`;
        break;
      }
    }
  } else if (offerCategory === "software") {
    switch (category) {
      case "cloud_migration":
      case "digital_transformation": {
        potentialBusinessImplication = `Modernizing core systems and migrating workloads requires robust software architecture, secure data integration, and continuous operational stability.`;
        break;
      }
      case "infrastructure_investment":
      case "company_expansion": {
        potentialBusinessImplication = `Supporting rapid business expansion demands scalable software systems and automated workflows to maintain performance without compounding operational overhead.`;
        break;
      }
      case "hiring": {
        potentialBusinessImplication = `Expanding technical teams often accelerates the need for modern development tooling, streamlined workflows, and automated deployment pipelines.`;
        break;
      }
      default: {
        potentialBusinessImplication = `Scaling key business initiatives requires dependable software capability and automated systems to support growing operational demands.`;
        break;
      }
    }
  } else if (offerCategory === "services" || offerCategory === "general") {
    // Professional Services, Consulting, or Neutral B2B (No artificial tech/hardware assumptions)
    switch (category) {
      case "company_expansion":
      case "infrastructure_investment": {
        potentialBusinessImplication = `As major commercial developments and expansions take shape, maintaining operational stability and managing organizational capacity become essential.`;
        break;
      }
      case "hiring": {
        potentialBusinessImplication = `Scaling teams and organizational capacity often requires streamlining operational workflows and partnering with external specialists to support growth.`;
        break;
      }
      case "leadership_change": {
        potentialBusinessImplication = `Executive transitions often prompt an immediate review of strategic partnerships, operating models, and key organizational priorities.`;
        break;
      }
      case "cloud_migration":
      case "digital_transformation":
      case "technology_adoption": {
        potentialBusinessImplication = `Executing large-scale strategic initiatives requires dependable operational execution, clear cross-functional alignment, and minimal disruption to existing workflows.`;
        break;
      }
      default: {
        potentialBusinessImplication = `As key strategic developments take shape, maintaining operational stability while balancing growth and execution is critical.`;
        break;
      }
    }
  } else {
    // Infrastructure / Compute / Hardware
    switch (category) {
      case "cloud_migration": {
        potentialBusinessImplication = `As critical workloads migrate to cloud environments, maintaining system resilience, managing cross-platform latency, and controlling compute consumption become paramount.`;
        break;
      }
      case "infrastructure_investment": {
        potentialBusinessImplication = `Scaling high-performance infrastructure requires balancing compute density, server availability, and operational overhead to support growing workloads efficiently.`;
        break;
      }
      case "hiring": {
        if (responsibilities && /hpc|compute|labs?|data cent(?:er|re)|server/i.test(responsibilities)) {
          potentialBusinessImplication = `As these environments evolve, maintaining reliable infrastructure and ensuring server capacity can scale efficiently become increasingly important.`;
        } else {
          potentialBusinessImplication = `Scaling leadership and technical teams often increases demand to streamline operational workflows and support growing infrastructure requirements.`;
        }
        break;
      }
      case "leadership_change": {
        potentialBusinessImplication = `Executive transitions often prompt an immediate review of existing vendor contracts, platform architectures, and key infrastructure priorities.`;
        break;
      }
      case "company_expansion": {
        potentialBusinessImplication = `Rapid business expansion intensifies operational demands across existing technical systems and accelerates the evaluation of scalable enterprise solutions.`;
        break;
      }
      case "digital_transformation": {
        potentialBusinessImplication = `Modernizing core systems requires continuous operational stability while avoiding downtime and friction across legacy workflows.`;
        break;
      }
      case "technology_adoption": {
        potentialBusinessImplication = `Adopting new technical capabilities requires dependable underlying infrastructure and scalable capacity to realize expected performance gains.`;
        break;
      }
      default: {
        potentialBusinessImplication = `As key business developments take shape, maintaining operational stability while balancing capacity and performance is critical.`;
        break;
      }
    }
  }

  return {
    observedFact,
    potentialBusinessImplication,
  };
}

