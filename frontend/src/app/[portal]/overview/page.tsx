"use client";

import { useEffect, useState } from "react";
import { PortalLink as Link } from "@/components/layout/PortalLink";
import { RequireCap } from "@/components/common/RequireCap";
import { LoadingState } from "@/components/common/LoadingState";
import {
  AdminDashboard,
  AnalystDashboard,
  PartnerDashboard,
  ResearcherDashboard,
  ReviewerDashboard,
  SdrDashboard,
} from "@/components/overview/RoleDashboards";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { ProcessGuide } from "@/components/guide/ProcessGuide";
import { MonitorsSummary } from "@/components/overview/MonitorsSummary";
import { getOffer, type Offer } from "@/lib/api/settings";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePersistentState } from "@/hooks/usePersistentState";
import { ArrowRight, Target } from "lucide-react";

/** Each role's dashboard: what's happening in its part of the workflow, and what to do next. */
const DASHBOARDS: Record<string, (p: { workspaceId: string }) => React.ReactNode> = {
  tenant_admin: AdminDashboard,
  researcher: ResearcherDashboard,
  sales_reviewer: ReviewerDashboard,
  sdr: SdrDashboard,
  analyst: AnalystDashboard,
  partner: PartnerDashboard,
};

type RoleGuideConfig = {
  eyebrow: string;
  title: string;
  description: string;
  primaryAction: {
    label: string;
    href: string;
  };
  cardTitle: string;
  cardDesc: string;
};

const ROLE_GUIDE_CONFIGS: Record<string, RoleGuideConfig> = {
  tenant_admin: {
    eyebrow: "Tenant Admin Guide",
    title: "Welcome to Insyder",
    description:
      "Insyder monitors the web for companies exhibiting strong buying signals matching your specific services. Start with your website: Insyder reads it and suggests your offer, targeting, products and buying signals.",
    primaryAction: {
      label: "Add your website",
      href: "/settings/offer",
    },
    cardTitle: "Ready to set up your workspace?",
    cardDesc: "Enter your company website in Settings. Insyder builds your company profile from it, and you review every suggestion before it is used.",
  },
  researcher: {
    eyebrow: "Researcher Guide",
    title: "Discover Accounts & Verify Evidence",
    description:
      "Find companies showing buying signals, inspect cited web sources, and assemble factual qualification briefs for sales review.",
    primaryAction: {
      label: "Find leads",
      href: "/discover/assign",
    },
    cardTitle: "Ready to discover buying signals?",
    cardDesc: "Run natural-language searches or import account lists to find companies with active infrastructure expansion.",
  },
  sales_reviewer: {
    eyebrow: "Sales Reviewer Guide",
    title: "Review Briefs & Sales Acceptance",
    description:
      "Inspect qualification briefs, approve high-fit opportunities, assign SDR owners, and coordinate CRM sync or partner handoffs.",
    primaryAction: {
      label: "Review briefs",
      href: "/accounts/review",
    },
    cardTitle: "Ready to review submitted briefs?",
    cardDesc: "Verify cited evidence, assign dedicated SDR owners, and decide sales acceptance for prospective deals.",
  },
  sdr: {
    eyebrow: "SDR Guide",
    title: "Targeted Outreach & Task Execution",
    description:
      "Work your assigned account queue, review verified buying signals, and send tailored outreach citing real evidence.",
    primaryAction: {
      label: "Start working",
      href: "/outreach/work",
    },
    cardTitle: "Ready to start outreach?",
    cardDesc: "Review your personal task queue, inspect cited evidence, and generate personalized outreach drafts.",
  },
  analyst: {
    eyebrow: "Analyst Guide",
    title: "Sales Analytics & Performance Reports",
    description:
      "Track pipeline conversion rates, evidence quality, SDR activity volumes, and research quota consumption.",
    primaryAction: {
      label: "Open full report",
      href: "/reports/outcomes",
    },
    cardTitle: "Ready to analyze pipeline metrics?",
    cardDesc: "Explore acceptance rates, SDR completed tasks, and research unit consumption in Outcomes reports.",
  },
  partner: {
    eyebrow: "Partner Guide",
    title: "Shared Account Handoffs",
    description:
      "Access and deliver subcontracting or regional services on account handoffs explicitly shared with your partner firm.",
    primaryAction: {
      label: "View shared handoffs",
      href: "/shared",
    },
    cardTitle: "Ready to review partner handoffs?",
    cardDesc: "Inspect permitted account briefs and acknowledge your assigned deliveries.",
  },
};

/** First-login walkthrough: shown until the user dismisses it, then the role dashboard takes over. */
function Guide({ workspaceId, onDismiss }: { workspaceId: string; onDismiss: () => void }) {
  const { role } = useWorkspace();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [offerLoaded, setOfferLoaded] = useState(false);

  useEffect(() => {
    getOffer(workspaceId)
      .then((r) => setOffer(r.offer))
      .catch(() => setOffer(null))
      .finally(() => setOfferLoaded(true));
  }, [workspaceId]);

  if (!offerLoaded) return <LoadingState />;

  const isConfigured = Boolean(offer?.offering && offer.offering.trim().length > 0);
  const config = ROLE_GUIDE_CONFIGS[role ?? ""] ?? ROLE_GUIDE_CONFIGS.tenant_admin;

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>{isConfigured ? config.eyebrow : "Initial Setup"}</Eyebrow>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-[var(--foreground)]">{config.title}</h1>
          <div className="flex items-center gap-2.5 shrink-0">
            <Link href={config.primaryAction.href} onClick={onDismiss}>
              <Button variant="primary" className="flex items-center gap-1.5 font-semibold">
                {config.primaryAction.label} <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Button variant="secondary" onClick={onDismiss}>
              Back to dashboard
            </Button>
          </div>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)] max-w-3xl">
          {config.description}
        </p>
      </div>

      {/* Role-tailored Process guide walkthrough */}
      <ProcessGuide role={role} isInitialSetup={!isConfigured} />

      {/* Role-tailored Action card */}
      <Card className="border-l-4 border-l-[var(--brand)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-[var(--brand-text)]" />
              <h3 className="text-base font-semibold text-[var(--foreground)]">{config.cardTitle}</h3>
            </div>
            <p className="text-sm text-[var(--muted)]">{config.cardDesc}</p>
          </div>
          <Link href={config.primaryAction.href} className="shrink-0" onClick={onDismiss}>
            <Button variant="primary" className="flex items-center gap-2 px-5 py-2.5 text-[15px] font-semibold">
              {config.primaryAction.label} <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

function Overview({ workspaceId }: { workspaceId: string }) {
  const { role, can } = useWorkspace();
  // Guide is shown once on first/initial login; once dismissed, it won't auto-open on future logins
  const [guideDismissed, setGuideDismissed] = usePersistentState<boolean>("overview:guideDismissed", false);
  const Dashboard = DASHBOARDS[role ?? ""] ?? AnalystDashboard;
  return (
    <div className="w-full min-w-0">
      {guideDismissed ? (
        <>
          <Dashboard workspaceId={workspaceId} />
          {/* Active monitors and their latest signals, for everyone who can see accounts */}
          {can("view_accounts") ? <MonitorsSummary workspaceId={workspaceId} /> : null}
        </>
      ) : (
        <Guide workspaceId={workspaceId} onDismiss={() => setGuideDismissed(true)} />
      )}
    </div>
  );
}

export default function OverviewPage() {
  return <RequireCap>{(workspaceId) => <Overview workspaceId={workspaceId} />}</RequireCap>;
}
