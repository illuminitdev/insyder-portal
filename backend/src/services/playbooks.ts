import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { playbookVersions } from "../db/schema/index.js";
import { newId } from "../utils/ids.js";
import { notFound, validationError } from "../utils/errors.js";

/** Signal types the research provider knows how to search for. */
export const SIGNAL_KINDS = [
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
] as const;

export type BuiltInSignalKind = (typeof SIGNAL_KINDS)[number];

export const customSignalSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).optional(),
});
export type CustomSignal = z.infer<typeof customSignalSchema>;

/** Exa's includeText accepts one phrase of up to five words. */
export const REQUIRED_PHRASE_MAX_WORDS = 5;

/**
 * A playbook's rules, stored as JSON on each version row. Every save writes a new version
 * (rows are never updated), so a research run always points at the exact rules it used (R1).
 */
export const playbookRulesSchema = z.object({
  signals: z
    .array(z.string().trim().min(1).max(80))
    .min(1, "Choose at least one signal")
    .max(50),
  customSignals: z.array(customSignalSchema).optional(),
  description: z.string().trim().max(200).optional().default(""),
  requiredEvidence: z.string().trim().max(600).optional().default(""),
  discoveryQuestion: z.string().trim().max(400).optional().default(""),
  /** ISO country codes the playbook searches by default; empty = workspace territory */
  countries: z.array(z.string().trim().min(2).max(2)).max(30).optional().default([]),
  industries: z.array(z.string().trim().min(1).max(60)).max(20).optional().default([]),
  /** Maximum event age for this playbook; null = workspace setting */
  eventWindowDays: z.number().int().min(7).max(730).nullable().optional().default(null),
  /** Exact phrase every search result must contain; empty = no phrase required */
  requiredPhrase: z
    .string()
    .trim()
    .max(60)
    .refine((v) => !v || v.split(/\s+/).length <= REQUIRED_PHRASE_MAX_WORDS, {
      message: `Use at most ${REQUIRED_PHRASE_MAX_WORDS} words`,
    })
    .optional(),
});
export type PlaybookRules = z.infer<typeof playbookRulesSchema> & { archived?: boolean };

export const playbookInputSchema = playbookRulesSchema.extend({
  name: z.string().trim().min(2, "Give the playbook a name").max(80),
});

/** Built-in playbooks every workspace starts with. They can be copied, not edited. */
export const BUILT_IN_PLAYBOOKS: Array<{ name: string; templateKey: string; rules: PlaybookRules }> = [
  {
    name: "Infrastructure expansion",
    templateKey: "infrastructure",
    rules: {
      signals: ["expansion", "infra_hiring", "refresh", "compute", "procurement"],
      description: "Facility expansion + infrastructure hiring",
      requiredEvidence: "Dated announcement, matching company and location, relevant role with a known date.",
      discoveryQuestion: "Will the site use local compute, central infrastructure or cloud services?",
      countries: [],
      industries: [],
      eventWindowDays: null,
    },
  },
  {
    name: "Hiring demand",
    templateKey: "recruitment",
    rules: {
      signals: ["infra_hiring", "expansion"],
      description: "Open infrastructure role + business expansion",
      requiredEvidence: "Dated announcement, matching company and location, relevant role with a known date.",
      discoveryQuestion: "Which roles are proving difficult to fill, and are external recruitment partners involved?",
      countries: [],
      industries: [],
      eventWindowDays: null,
    },
  },
  {
    name: "Multi-site IT support",
    templateKey: "managed_it",
    rules: {
      signals: ["refresh", "expansion", "procurement"],
      description: "New site + operations hiring",
      requiredEvidence: "Dated announcement, matching company and location, relevant role with a known date.",
      discoveryQuestion: "Who will support the new site, and will existing providers cover this location?",
      countries: [],
      industries: [],
      eventWindowDays: null,
    },
  },
  {
    name: "Cloud & modern technology",
    templateKey: "cloud_modernization",
    rules: {
      signals: ["cloud_migration", "digital_transformation", "technology_adoption", "compute"],
      description: "Cloud migration, digital transformation & platform adoption",
      requiredEvidence: "Public announcement, case study or executive statement on cloud or digital modernization.",
      discoveryQuestion: "Which legacy workloads or data systems are prioritized for cloud migration?",
      countries: [],
      industries: [],
      eventWindowDays: null,
    },
  },
  {
    name: "Executive & strategic growth",
    templateKey: "strategic_growth",
    rules: {
      signals: ["funding", "m_and_a", "leadership_change", "expansion"],
      description: "New leadership, funding rounds, M&A & corporate expansion",
      requiredEvidence: "Official press release, regulatory filing or verified news on funding, M&A or executive hiring.",
      discoveryQuestion: "How are the new leadership or recent capital infusion shaping your technology roadmap?",
      countries: [],
      industries: [],
      eventWindowDays: null,
    },
  },
];
const BUILT_IN = new Map(BUILT_IN_PLAYBOOKS.map((p) => [p.templateKey, p]));

export const isBuiltIn = (templateKey: string) => BUILT_IN.has(templateKey);

type Row = typeof playbookVersions.$inferSelect;

/** Rules of a stored version, with the built-in texts filled in for rows saved before they existed */
export function rulesOf(row: Pick<Row, "templateKey" | "rulesJson">): PlaybookRules {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(row.rulesJson) as Record<string, unknown>;
  } catch {
    // keep defaults
  }
  const base = BUILT_IN.get(row.templateKey)?.rules;
  const rawCustomSignals = Array.isArray(raw.customSignals)
    ? (raw.customSignals as unknown[]).flatMap((item) => {
        const parsed = customSignalSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const customKeys = new Set(rawCustomSignals.map((c) => c.key));
  const signals = Array.isArray(raw.signals)
    ? (raw.signals as string[]).filter(
        (s) =>
          (SIGNAL_KINDS as readonly string[]).includes(s) ||
          s.startsWith("custom_") ||
          customKeys.has(s),
      )
    : [];
  return {
    signals: signals.length ? signals : (base?.signals ?? ["expansion"]),
    customSignals: rawCustomSignals.length ? rawCustomSignals : (base?.customSignals ?? []),
    description: (raw.description as string) || base?.description || "",
    requiredEvidence: (raw.requiredEvidence as string) || base?.requiredEvidence || "",
    discoveryQuestion: (raw.discoveryQuestion as string) || base?.discoveryQuestion || "",
    countries: Array.isArray(raw.countries) ? (raw.countries as string[]) : [],
    industries: Array.isArray(raw.industries) ? (raw.industries as string[]) : [],
    eventWindowDays: typeof raw.eventWindowDays === "number" ? raw.eventWindowDays : null,
    requiredPhrase: typeof raw.requiredPhrase === "string" ? raw.requiredPhrase : "",
    archived: raw.archived === true,
  };
}

export type PlaybookView = {
  id: string;
  templateKey: string;
  name: string;
  version: number;
  builtIn: boolean;
  archived: boolean;
  rules: PlaybookRules;
  createdAt: Date;
};

const view = (r: Row): PlaybookView => {
  const rules = rulesOf(r);
  return {
    id: r.id,
    templateKey: r.templateKey,
    name: BUILT_IN.get(r.templateKey)?.name ?? r.name,
    version: r.version,
    builtIn: isBuiltIn(r.templateKey),
    archived: Boolean(rules.archived),
    rules,
    createdAt: r.createdAt,
  };
};

/** The latest version of every playbook in the workspace (archived included; callers filter) */
export async function listPlaybooks(workspaceId: string): Promise<PlaybookView[]> {
  const rows = await getDb()
    .select()
    .from(playbookVersions)
    .where(eq(playbookVersions.workspaceId, workspaceId))
    .orderBy(desc(playbookVersions.version));
  const latest = new Map<string, Row>();
  for (const r of rows) if (!latest.has(r.templateKey)) latest.set(r.templateKey, r);
  const order = (k: string) => {
    const i = BUILT_IN_PLAYBOOKS.findIndex((p) => p.templateKey === k);
    return i === -1 ? 100 : i;
  };
  return [...latest.values()]
    .map(view)
    .sort((a, b) => order(a.templateKey) - order(b.templateKey) || a.createdAt.getTime() - b.createdAt.getTime());
}

export async function latestPlaybook(workspaceId: string, templateKey: string): Promise<PlaybookView | null> {
  const [row] = await getDb()
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.workspaceId, workspaceId), eq(playbookVersions.templateKey, templateKey)))
    .orderBy(desc(playbookVersions.version))
    .limit(1);
  return row ? view(row) : null;
}

export async function getPlaybookVersion(workspaceId: string, id: string): Promise<PlaybookView | null> {
  const [row] = await getDb()
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.workspaceId, workspaceId), eq(playbookVersions.id, id)))
    .limit(1);
  return row ? view(row) : null;
}

export async function playbookHistory(workspaceId: string, templateKey: string) {
  const rows = await getDb()
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.workspaceId, workspaceId), eq(playbookVersions.templateKey, templateKey)))
    .orderBy(desc(playbookVersions.version));
  if (!rows.length) throw notFound("Playbook not found");
  return rows.map(view);
}

function slug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "playbook"
  );
}

export async function createPlaybook(
  tenantId: string,
  workspaceId: string,
  input: z.infer<typeof playbookInputSchema>,
): Promise<PlaybookView> {
  const existing = await listPlaybooks(workspaceId);
  if (existing.some((p) => p.name.toLowerCase() === input.name.toLowerCase())) {
    throw validationError("A playbook with that name already exists");
  }
  const { name, ...rules } = input;
  const id = newId("pbk");
  const [row] = await getDb()
    .insert(playbookVersions)
    .values({
      id,
      tenantId,
      workspaceId,
      name,
      templateKey: `custom_${slug(name)}_${id.slice(-6).toLowerCase()}`,
      version: 1,
      rulesJson: JSON.stringify(rules),
    })
    .returning();
  return view(row!);
}

/** Saves changes as a new version. Built-in playbooks can't be changed; copy them instead. */
export async function updatePlaybook(
  tenantId: string,
  workspaceId: string,
  templateKey: string,
  input: z.infer<typeof playbookInputSchema>,
): Promise<PlaybookView> {
  if (isBuiltIn(templateKey)) throw validationError("Built-in playbooks can't be edited. Copy it to make your own.");
  const current = await latestPlaybook(workspaceId, templateKey);
  if (!current) throw notFound("Playbook not found");
  const others = await listPlaybooks(workspaceId);
  if (others.some((p) => p.templateKey !== templateKey && p.name.toLowerCase() === input.name.toLowerCase())) {
    throw validationError("A playbook with that name already exists");
  }
  const { name, ...rules } = input;
  const [row] = await getDb()
    .insert(playbookVersions)
    .values({
      id: newId("pbk"),
      tenantId,
      workspaceId,
      name,
      templateKey,
      version: current.version + 1,
      rulesJson: JSON.stringify({ ...rules, archived: current.archived }),
    })
    .returning();
  return view(row!);
}

/** Archive or restore (also a new version, so history stays complete) */
export async function setPlaybookArchived(
  tenantId: string,
  workspaceId: string,
  templateKey: string,
  archived: boolean,
  activeTemplateKey: string | null,
): Promise<PlaybookView> {
  if (isBuiltIn(templateKey)) throw validationError("Built-in playbooks can't be archived");
  if (archived && templateKey === activeTemplateKey) {
    throw validationError("This is the active playbook. Choose another one first, then archive it.");
  }
  const current = await latestPlaybook(workspaceId, templateKey);
  if (!current) throw notFound("Playbook not found");
  if (current.archived === archived) return current;
  const { archived: _ignored, ...rules } = current.rules;
  const [row] = await getDb()
    .insert(playbookVersions)
    .values({
      id: newId("pbk"),
      tenantId,
      workspaceId,
      name: current.name,
      templateKey,
      version: current.version + 1,
      rulesJson: JSON.stringify({ ...rules, archived }),
    })
    .returning();
  return view(row!);
}

/** Collect all unique custom signal definitions defined across playbooks in a workspace */
export function extractWorkspaceCustomSignals(playbooks: PlaybookView[]): CustomSignal[] {
  const map = new Map<string, CustomSignal>();
  for (const p of playbooks) {
    if (p.rules.customSignals) {
      for (const cs of p.rules.customSignals) {
        if (!map.has(cs.key)) {
          map.set(cs.key, cs);
        }
      }
    }
    // Also derive from any signals starting with custom_
    for (const s of p.rules.signals) {
      if (s.startsWith("custom_") && !map.has(s)) {
        const cleanName = s.replace(/^custom_/, "").replace(/_/g, " ");
        const capitalized = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
        map.set(s, { key: s, label: capitalized });
      }
    }
  }
  return Array.from(map.values());
}
