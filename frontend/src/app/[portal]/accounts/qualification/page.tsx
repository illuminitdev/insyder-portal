"use client";

import { PortalLink as Link } from "@/components/layout/PortalLink";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { QualificationBrief } from "@/components/qualification/QualificationBrief";
import { RequireCap } from "@/components/common/RequireCap";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { getBrief, type Brief } from "@/lib/api/accounts";
import { Button } from "@/components/ui/Button";

function QualificationView({ workspaceId, accountId }: { workspaceId: string; accountId: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBrief(await getBrief(accountId, workspaceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [accountId, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) return <ErrorState message={error} />;
  if (!brief) return <LoadingState label="Loading qualification…" />;

  return (
    <div className="mx-auto max-w-[860px] space-y-6">
      <PageHeader
        eyebrow={brief.account.name}
        title="Qualification brief"
        description="Each fact records its basis and support. Unknown stays unknown; superseded values are kept in history."
        actions={
          <Link href={`/accounts/detail?id=${accountId}&step=qualify`}>
            <Button>Back to account</Button>
          </Link>
        }
      />
      <QualificationBrief workspaceId={workspaceId} accountId={accountId} brief={brief} onSaved={refresh} />
    </div>
  );
}

export default function QualificationPage() {
  const accountId = useSearchParams().get("id") ?? "";
  return (
    <RequireCap cap="view_accounts">
      {(workspaceId) => <QualificationView workspaceId={workspaceId} accountId={accountId} />}
    </RequireCap>
  );
}
