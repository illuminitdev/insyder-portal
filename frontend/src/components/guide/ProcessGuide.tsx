"use client";

import { PortalLink as Link } from "@/components/layout/PortalLink";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ROLE_LABELS } from "@/lib/auth/capabilities";

type GuideStep = {
  num: number;
  title: string;
  badge: string;
  href: string;
  action: string;
  desc: string;
  isCurrent?: boolean;
};

type RoleWorkflow = {
  title: string;
  subtitle: string;
  steps: GuideStep[];
};

export function ProcessGuide({
  isInitialSetup = false,
  role: overrideRole,
}: {
  isInitialSetup?: boolean;
  role?: string | null;
}) {
  const { role: currentRole } = useWorkspace();
  const role = overrideRole ?? currentRole ?? "tenant_admin";

  const workflows: Record<string, RoleWorkflow> = {
    tenant_admin: {
      title: "Tenant Admin Workflow: Setup to Pipeline Oversight",
      subtitle: "Configure company offerings, manage team access, and oversee the end-to-end sales lifecycle:",
      steps: [
        {
          num: 1,
          title: "Define What You Sell",
          badge: "Settings → Offer & targeting",
          href: "/settings/offer",
          action: "Configure offerings",
          desc: "Set your core products and services, target buyer roles, and geographic territory. Insyder uses these as defaults for signal discovery.",
          isCurrent: isInitialSetup,
        },
        {
          num: 2,
          title: "Invite Team Members",
          badge: "Members",
          href: "/members",
          action: "Manage team access",
          desc: "Add your team with role-based access: Researchers (evidence), SDRs (outreach), Reviewers (approvals), Analysts (reports), and Partners (handoffs).",
        },
        {
          num: 3,
          title: "Connect CRM & Suppressions",
          badge: "Settings → Connect to CRM",
          href: "/settings/crm",
          action: "Connect your CRM",
          desc: "Connect HubSpot or Salesforce CRM so qualified opportunities sync automatically, and configure domain suppressions to avoid contacting current clients.",
        },
        {
          num: 4,
          title: "Find Matching Prospects",
          badge: "Discover → Find & assign",
          href: "/discover/assign",
          action: "Start lead discovery",
          desc: "Select an active signal playbook and run natural-language searches to find companies showing live trigger events (expansions, hiring, migrations).",
        },
        {
          num: 5,
          title: "Review Evidence & Qualify",
          badge: "Accounts → Qualify a lead",
          href: "/accounts/qualify",
          action: "Qualify a lead",
          desc: "Inspect cited web sources, confirm publication dates, and structure a qualification brief with factual basis (use case, timeline, budget).",
        },
        {
          num: 6,
          title: "Sales Acceptance",
          badge: "Accounts → Sales acceptance",
          href: "/accounts/sales-acceptance",
          action: "Review sales pipeline",
          desc: "Sales managers review the brief, verify reviewed evidence, assign an accountable SDR owner, and set the next sales action.",
        },
        {
          num: 7,
          title: "SDR Outreach & Tasks",
          badge: "Outreach → Tasks",
          href: "/outreach/tasks",
          action: "Manage outreach tasks",
          desc: "SDRs receive accepted accounts, generate outreach email drafts directly tied to verified evidence, and record task call outcomes.",
        },
        {
          num: 8,
          title: "Partner Handoff (Optional)",
          badge: "Accounts → Pipeline",
          href: "/accounts/pipeline",
          action: "Prepare partner handoffs",
          desc: "If an account needs external fulfillment, sales reviewers can prepare a handoff and share permitted fields with external Partner users.",
        },
        {
          num: 9,
          title: "Analyze Outcomes & Quotas",
          badge: "Reports → Outcomes",
          href: "/reports/outcomes",
          action: "View analytics & reports",
          desc: "Analysts and leadership review conversion rates, SDR activity volumes, evidence quality, and research quota consumption in Reports.",
        },
      ],
    },

    researcher: {
      title: "Researcher Workflow: Discovery to Qualification",
      subtitle: "Find accounts showing buying signals, verify public evidence sources, and build structured briefs for sales review:",
      steps: [
        {
          num: 1,
          title: "Check Active Playbook",
          badge: "Discover → Playbooks",
          href: "/discover/playbooks",
          action: "View active playbooks",
          desc: "Review your active signal model (such as infrastructure expansion, tech migration, or hiring surge) to understand what signals to look for.",
          isCurrent: isInitialSetup,
        },
        {
          num: 2,
          title: "Discover Leads & Signals",
          badge: "Discover → Find & assign",
          href: "/discover/assign",
          action: "Discover target leads",
          desc: "Run natural-language discovery searches or import account CSVs to surface target companies with recent buying signals.",
        },
        {
          num: 3,
          title: "Inspect Watchlist & Evidence",
          badge: "Accounts → Watchlist & imports",
          href: "/accounts/watchlist",
          action: "Inspect watchlist & sources",
          desc: "Review newly discovered accounts, inspect cited web sources, and confirm publication dates before qualification.",
        },
        {
          num: 4,
          title: "Build Qualification Brief",
          badge: "My leads → Qualify a lead",
          href: "/accounts/qualify",
          action: "Build qualification brief",
          desc: "Synthesize the opportunity: record facts with their explicit basis (observed in source, hypothesis, confirmed) for workload, timeframe, and budget.",
        },
        {
          num: 5,
          title: "Submit Brief for Sales Review",
          badge: "My leads → Qualify a lead",
          href: "/accounts/qualify",
          action: "Submit brief for review",
          desc: "Confirm at least one evidence source is marked as reviewed, add your rationale notes, and submit the brief for sales acceptance.",
        },
        {
          num: 6,
          title: "Work My Research Tasks",
          badge: "My leads → Work my tasks",
          href: "/outreach/work",
          action: "Work research queue",
          desc: "Check your task queue for any leads returned by sales reviewers requesting additional evidence verification or source corroboration.",
        },
        {
          num: 7,
          title: "Track Research Usage",
          badge: "Settings → Usage",
          href: "/settings/usage",
          action: "Check usage & quota",
          desc: "Monitor your monthly research runs and API query consumption against workspace limits in Settings.",
        },
      ],
    },

    sales_reviewer: {
      title: "Sales Reviewer Workflow: Acceptance & Account Handoffs",
      subtitle: "Review researcher briefs, approve qualified opportunities, assign SDR owners, and coordinate CRM/partner handoffs:",
      steps: [
        {
          num: 1,
          title: "Review Submitted Briefs",
          badge: "Review → Review a brief",
          href: "/accounts/review",
          action: "Review briefs",
          desc: "Inspect researchers' qualification briefs, verify cited evidence dates, and review identified buying triggers.",
          isCurrent: isInitialSetup,
        },
        {
          num: 2,
          title: "Sales Acceptance Decision",
          badge: "Review → Sales acceptance",
          href: "/accounts/sales-acceptance",
          action: "Make acceptance decision",
          desc: "Decide whether to Accept into pipeline, Return for more evidence (with guidance), or Reject with a specific reason code.",
        },
        {
          num: 3,
          title: "Assign SDR Owner & Next Action",
          badge: "Review → Sales acceptance",
          href: "/accounts/sales-acceptance",
          action: "Assign SDR & next action",
          desc: "When accepting, designate an accountable SDR owner and record the exact required next sales action (e.g. 'Call Head of Infrastructure').",
        },
        {
          num: 4,
          title: "Sync to CRM (Optional)",
          badge: "Accounts → Send to CRM",
          href: "/accounts/crm",
          action: "Sync opportunities to CRM",
          desc: "Push accepted accounts, verified contacts, and deal opportunities directly into your connected HubSpot or Salesforce CRM.",
        },
        {
          num: 5,
          title: "Prepare Partner Handoffs",
          badge: "Accounts → Pipeline",
          href: "/accounts/pipeline",
          action: "Prepare partner handoffs",
          desc: "When subcontracting or external delivery is needed, create a partner handoff and share authorized brief fields with external Partner users.",
        },
        {
          num: 6,
          title: "Track SDR Task Progress",
          badge: "Outreach → Tasks",
          href: "/outreach/tasks",
          action: "Track task progress",
          desc: "Monitor team outreach execution, track overdue tasks, and review pipeline acceptance rates in Reports.",
        },
      ],
    },

    sdr: {
      title: "SDR Workflow: Outreach Execution & Task Outcomes",
      subtitle: "Work your assigned accounts, send evidence-backed outreach, and log conversation outcomes:",
      steps: [
        {
          num: 1,
          title: "Work My Task Queue",
          badge: "My work → Work my tasks",
          href: "/outreach/work",
          action: "Work outreach queue",
          desc: "Work your personalized queue of pending outreach tasks (calls, emails, follow-ups) ranked by priority and due date.",
          isCurrent: isInitialSetup,
        },
        {
          num: 2,
          title: "Inspect Account Buying Signals",
          badge: "Accounts → My accounts",
          href: "/accounts/watchlist",
          action: "Inspect account signals",
          desc: "Review your accepted accounts, inspect verified buying signals, and check qualification rationale before reaching out.",
        },
        {
          num: 3,
          title: "Generate Evidence-Backed Drafts",
          badge: "Outreach → Drafts",
          href: "/outreach/drafts",
          action: "Generate outreach drafts",
          desc: "Generate outreach email drafts citing verified public evidence. Copy or export to send directly from your own email client.",
        },
        {
          num: 4,
          title: "Log Task & Call Outcomes",
          badge: "My work → Tasks",
          href: "/outreach/tasks",
          action: "Log task outcomes",
          desc: "Mark completed tasks and record explicit conversation outcomes (e.g. 'Connected with Decision Maker', 'Demo Scheduled').",
        },
        {
          num: 5,
          title: "Track Pipeline Milestones",
          badge: "Accounts → Pipeline",
          href: "/accounts/pipeline",
          action: "Track pipeline stages",
          desc: "Update account stages from Initial Outreach to Discovery and Meeting Held, and monitor conversion in Reports.",
        },
      ],
    },

    partner: {
      title: "Partner Workflow: External Handoffs",
      subtitle: "Collaborate on accounts shared with your partner firm with strictly controlled access:",
      steps: [
        {
          num: 1,
          title: "View Shared Handoffs",
          badge: "Shared with me → Shared handoffs",
          href: "/shared",
          action: "View shared handoffs",
          desc: "View only the specific account handoffs explicitly shared with your partner organization by the sales team.",
          isCurrent: isInitialSetup,
        },
        {
          num: 2,
          title: "Review Permitted Information",
          badge: "Shared with me → Shared handoffs",
          href: "/shared",
          action: "Review handoff details",
          desc: "Inspect authorized details: account name, verified buying signals, recommended solutions, and required delivery actions.",
        },
        {
          num: 3,
          title: "Acknowledge Receipt",
          badge: "Shared with me → Shared handoffs",
          href: "/shared",
          action: "Acknowledge receipt",
          desc: "Click Acknowledge to confirm receipt and notify the primary account owner that your team is actively engaging.",
        },
        {
          num: 4,
          title: "Deliver & Coordinate",
          badge: "Shared with me → Shared handoffs",
          href: "/shared",
          action: "Coordinate fulfillment",
          desc: "Execute regional fulfillment or subcontracting services and communicate status updates back to the client team.",
        },
      ],
    },

    analyst: {
      title: "Analyst Workflow: Sales Velocity & Quality Reports",
      subtitle: "Track pipeline health, evidence quality, and team conversion metrics without making operational changes:",
      steps: [
        {
          num: 1,
          title: "Sales Acceptance & Conversion",
          badge: "Reports → Outcomes",
          href: "/reports/outcomes",
          action: "Analyze conversion rates",
          desc: "Evaluate pipeline acceptance rates, returned and rejected brief reasons, and lead velocity across 30, 60, and 90-day windows.",
          isCurrent: isInitialSetup,
        },
        {
          num: 2,
          title: "Evidence Quality & Yield",
          badge: "Reports → Outcomes",
          href: "/reports/outcomes",
          action: "Audit evidence quality",
          desc: "Audit the proportion of dated vs undated evidence sources, source credibility, and research run yield across accounts.",
        },
        {
          num: 3,
          title: "SDR Outreach Activity",
          badge: "Reports → Outcomes",
          href: "/reports/outcomes",
          action: "Monitor outreach metrics",
          desc: "Monitor team task completion by action type (calls, emails, follow-ups) and inspect resulting prospect engagement rates.",
        },
        {
          num: 4,
          title: "Quota & API Consumption",
          badge: "Reports → Outcomes",
          href: "/reports/outcomes",
          action: "Inspect quota consumption",
          desc: "Track research unit consumption, search credit burn, and workspace entitlement utilization against monthly limits.",
        },
      ],
    },
  };

  const currentWorkflow = workflows[role] ?? workflows.tenant_admin;
  const roleLabel = ROLE_LABELS[role] ?? role;

  return (
    <div className="rounded-[10px] border border-[var(--line)] bg-white p-6 shadow-xs">
      <div className="text-[var(--foreground)]">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{currentWorkflow.title}</h2>
          <span className="rounded bg-[var(--chip-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)]">
            {roleLabel}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">{currentWorkflow.subtitle}</p>
      </div>

      <div
        className={`mt-5 grid gap-4 ${
          currentWorkflow.steps.length <= 4
            ? "sm:grid-cols-2 lg:grid-cols-4"
            : "sm:grid-cols-2 lg:grid-cols-3"
        }`}
      >
        {currentWorkflow.steps.map((s) => (
          <Link
            key={s.num}
            href={s.href}
            className={`group flex flex-col justify-between rounded-[10px] p-4.5 transition-all duration-150 ${
              s.isCurrent
                ? "border-2 border-[var(--brand)] bg-[var(--card)] shadow-xs"
                : "border border-[var(--line)] bg-[var(--card)] hover:border-[var(--brand-active)] hover:shadow-xs"
            }`}
          >
            <div>
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  s.isCurrent
                    ? "bg-[var(--brand)] text-[var(--on-brand)] shadow-2xs"
                    : "bg-[var(--chip-bg)] text-[var(--foreground)]"
                }`}
              >
                {s.num}
              </span>

              <div className="mt-3">
                <span className="inline-block rounded bg-[var(--chip-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
                  {s.badge}
                </span>
                <h3 className="mt-2 text-sm font-semibold text-[var(--foreground)] transition-colors group-hover:text-[var(--brand-active)]">
                  {s.title}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">{s.desc}</p>
              </div>
            </div>

            <div className="mt-4 border-t border-[var(--line)] pt-3">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-active)] group-hover:underline">
                {s.action} →
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
