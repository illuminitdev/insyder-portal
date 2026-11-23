"use client";

import { Compass } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProcessGuide } from "@/components/guide/ProcessGuide";
import { startProductTour } from "@/components/guide/ProductTour";
import { Button } from "@/components/ui/Button";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ROLE_LABELS } from "@/lib/auth/capabilities";

export default function HowItWorksPage() {
  const { role } = useWorkspace();
  const roleLabel = (role && ROLE_LABELS[role]) ?? "Team Member";
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title={`How Insyder works: ${roleLabel} Workflow`}
        description="A tailored guide to your role's specific responsibilities, tools, and actions in Insyder."
        actions={
          <Button className="hidden lg:inline-flex" onClick={startProductTour}>
            <span className="inline-flex items-center gap-1.5">
              <Compass size={15} aria-hidden />
              Take the tour
            </span>
          </Button>
        }
      />
      <ProcessGuide role={role} />
    </div>
  );
}
