import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { offers } from "../db/schema/index.js";
import { getResearchProvider } from "../providers/research/index.js";
import type { CompanyProfile } from "../providers/research/types.js";
import { newId } from "../utils/ids.js";
import { AppError, validationError } from "../utils/errors.js";
import { NormalizedProviderError } from "../providers/research/types.js";
import { normalizeDomain, normalizeWebsite } from "../utils/normalize.js";
import { writeAudit } from "./audit.js";
import { refundResearchBudget, reserveResearchBudget } from "./budget.js";
import { createPlaybook, listPlaybooks } from "./playbooks.js";

/** Research units one website analysis uses */
export const PROFILE_RUN_UNITS = 1;
/** A run still "running" after this long is given up on (and refunded) */
const PROFILE_TIMEOUT_MS = 15 * 60_000;

type Scope = { tenantId: string; workspaceId: string; actorUserId: string };

export type ProfileState = {
  website: string | null;
  status: "none" | "running" | "completed" | "failed";
  error: string | null;
  profile: CompanyProfile | null;
  updatedAt: Date | null;
};

export function profileAgentAvailable() {
  try {
    const p = getResearchProvider();
    return Boolean(p.startProfileAgent && p.getProfileAgent);
  } catch {
    return false;
  }
}

export function parseProfile(json: string | null | undefined): CompanyProfile | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as CompanyProfile;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

async function offerRow(workspaceId: string) {
  const [row] = await getDb().select().from(offers).where(eq(offers.workspaceId, workspaceId)).limit(1);
  return row ?? null;
}

/** The workspace's offer row, created empty if it doesn't exist yet (first-time setup). */
async function ensureOfferRow(tenantId: string, workspaceId: string) {
  const existing = await offerRow(workspaceId);
  if (existing) return existing;
  const [row] = await getDb()
    .insert(offers)
    .values({ id: newId("ofr"), tenantId, workspaceId })
    .returning();
  return row!;
}

/** Start reading our website. Uses research units; one analysis at a time per workspace. */
export async function startProfileAnalysis(s: Scope, rawWebsite: string): Promise<ProfileState> {
  const website = normalizeWebsite(rawWebsite);
  if (!website) throw validationError(`"${rawWebsite}" is not a website address — use e.g. yourcompany.com`);
  const provider = getResearchProvider();
  if (!provider.startProfileAgent || !provider.getProfileAgent) {
    throw validationError("Website analysis needs the Exa research provider, which isn't set up here");
  }

  const row = await ensureOfferRow(s.tenantId, s.workspaceId);
  if (row.profileStatus === "running") return getProfileState(s.workspaceId);

  await reserveResearchBudget(s.tenantId, PROFILE_RUN_UNITS);
  let runId: string;
  try {
    ({ runId } = await provider.startProfileAgent(website));
  } catch (e) {
    await refundResearchBudget(s.tenantId, PROFILE_RUN_UNITS);
    // Show Exa's problem to the user instead of a bare "Internal server error"
    if (e instanceof NormalizedProviderError) throw new AppError(502, `${e.message}. No research units were used.`, e.code);
    throw e;
  }

  const now = new Date();
  await getDb()
    .update(offers)
    .set({
      sellerWebsite: website,
      profileRunId: runId,
      profileStatus: "running",
      profileError: null,
      profileStartedAt: now,
      updatedAt: now,
    })
    .where(eq(offers.id, row.id));
  await writeAudit({
    tenantId: s.tenantId,
    workspaceId: s.workspaceId,
    actorUserId: s.actorUserId,
    action: "settings.company_profile.started",
    metadata: { website },
  });
  return getProfileState(s.workspaceId);
}

/**
 * The analysis state. While it is running, checks the agent once and records the result;
 * only one caller can record it (conditional update), so units are refunded at most once.
 */
export async function getProfileState(workspaceId: string, tenantId?: string): Promise<ProfileState> {
  let row = await offerRow(workspaceId);
  if (row?.profileStatus === "running" && row.profileRunId && tenantId) {
    await checkRunningProfile(row, tenantId);
    row = await offerRow(workspaceId);
  }
  if (!row) return { website: null, status: "none", error: null, profile: null, updatedAt: null };
  const status = (row.profileStatus as ProfileState["status"] | null) ?? "none";
  return {
    website: row.sellerWebsite,
    status,
    error: row.profileError,
    profile: parseProfile(row.companyProfileJson),
    updatedAt: row.profileUpdatedAt,
  };
}

async function checkRunningProfile(row: NonNullable<Awaited<ReturnType<typeof offerRow>>>, tenantId: string) {
  const provider = getResearchProvider();
  const runId = row.profileRunId!;
  const finish = async (values: Partial<typeof offers.$inferInsert>, refund: boolean) => {
    const done = await getDb()
      .update(offers)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(offers.id, row.id), eq(offers.profileRunId, runId), eq(offers.profileStatus, "running")))
      .returning({ id: offers.id });
    if (done[0] && refund) await refundResearchBudget(tenantId, PROFILE_RUN_UNITS);
  };

  const started = row.profileStartedAt?.getTime() ?? 0;
  if (Date.now() - started > PROFILE_TIMEOUT_MS) {
    await finish({ profileStatus: "failed", profileError: "The analysis took too long. Try again." }, true);
    return;
  }
  if (!provider.getProfileAgent) return;

  let result;
  try {
    result = await provider.getProfileAgent(runId);
  } catch {
    return; // Exa unreachable for a moment: try again on the next check
  }
  if (result.status === "running") return;
  if (result.status === "failed") {
    await finish({ profileStatus: "failed", profileError: "We couldn't read the website. Check the address and try again." }, true);
    return;
  }
  if (!result.profile) {
    await finish(
      { profileStatus: "failed", profileError: "Not enough was found on the website to build a profile. Fill in the settings by hand." },
      true,
    );
    return;
  }
  await finish(
    {
      profileStatus: "completed",
      profileError: null,
      companyProfileJson: JSON.stringify(result.profile),
      profileUpdatedAt: new Date(),
    },
    false,
  );
}

export type ApplySections = {
  offering?: boolean;
  companyName?: boolean;
  industries?: boolean;
  buyerRoles?: boolean;
  territory?: boolean;
  companySizes?: boolean;
  products?: boolean;
  /** Create a playbook from the suggested signals */
  playbook?: boolean;
  /** ...and make it the workspace's default playbook */
  makeDefault?: boolean;
};

/** Copy the chosen parts of the profile into the workspace settings. */
export async function applyProfile(s: Scope, sections: ApplySections) {
  const row = await offerRow(s.workspaceId);
  const profile = parseProfile(row?.companyProfileJson);
  if (!row || !profile) throw validationError("Analyse your website first");

  const set: Partial<typeof offers.$inferInsert> = {};
  const applied: string[] = [];
  if (sections.offering && profile.offering) {
    set.offering = profile.offering.slice(0, 300);
    applied.push("offering");
  }
  if (sections.companyName && profile.companyName) {
    set.sellerCompany = profile.companyName.slice(0, 120);
    applied.push("companyName");
  }
  if (sections.industries && profile.industries.length) {
    set.industriesJson = JSON.stringify(profile.industries.slice(0, 30));
    applied.push("industries");
  }
  if (sections.buyerRoles && profile.buyerRoles.length) {
    set.buyerRolesJson = JSON.stringify(profile.buyerRoles.slice(0, 30));
    applied.push("buyerRoles");
  }
  if (sections.territory && profile.countries.length) {
    set.territoryJson = JSON.stringify(profile.countries.slice(0, 30));
    applied.push("territory");
  }
  if (sections.companySizes && profile.companySizes.length) {
    set.companySizesJson = JSON.stringify(profile.companySizes.slice(0, 10));
    applied.push("companySizes");
  }
  if (sections.products && profile.products.length) {
    set.offerItemsJson = JSON.stringify(profile.products.slice(0, 15));
    applied.push("products");
  }

  let playbook: { templateKey: string; name: string } | null = null;
  if (sections.playbook && (profile.signals.length || profile.customSignals.length)) {
    const customSignals = profile.customSignals.map((c) => ({
      key: `custom_${c.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)}`,
      label: c.label,
      description: c.description.slice(0, 300),
    }));
    const taken = new Set((await listPlaybooks(s.workspaceId)).map((p) => p.name.toLowerCase()));
    const base = "Suggested from your website";
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    const domain = normalizeDomain(row.sellerWebsite);
    const created = await createPlaybook(s.tenantId, s.workspaceId, {
      name,
      signals: [...profile.signals.map((x) => x.key), ...customSignals.map((c) => c.key)],
      customSignals,
      description: `Signals suggested from ${domain ?? "your website"}`.slice(0, 200),
      requiredEvidence: "",
      discoveryQuestion: profile.discoveryQuestion.slice(0, 400),
      countries: profile.countries.slice(0, 30),
      industries: profile.industries.filter((i) => i.length <= 60).slice(0, 20),
      eventWindowDays: null,
    });
    playbook = { templateKey: created.templateKey, name: created.name };
    applied.push("playbook");
    if (sections.makeDefault) set.activePlaybookTemplateKey = created.templateKey;
  }

  if (Object.keys(set).length) {
    await getDb()
      .update(offers)
      .set({ ...set, version: row.version + 1, updatedAt: new Date() })
      .where(eq(offers.id, row.id));
  }
  await writeAudit({
    tenantId: s.tenantId,
    workspaceId: s.workspaceId,
    actorUserId: s.actorUserId,
    action: "settings.company_profile.applied",
    metadata: { applied },
  });
  return { applied, playbook };
}
