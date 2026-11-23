"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RequireCap } from "@/components/common/RequireCap";
import { CrmConnectionCard } from "@/components/settings/CrmConnectionCard";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getConnections } from "@/lib/api/settings";

function ConnectCrmView({ workspaceId }: { workspaceId: string }) {
  const { can, workspaceName } = useWorkspace();
  // Whether CRM sync is switched on for this workspace (shown on the connection badge)
  const [syncEnabled, setSyncEnabled] = useState(true);

  useEffect(() => {
    getConnections(workspaceId)
      .then((d) => setSyncEnabled(d.crm.enabled))
      .catch(() => undefined);
  }, [workspaceId]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Connect to CRM"
        description={`Connect a CRM for the ${workspaceName ?? "current"} workspace so its accepted leads can be sent there. Each workspace has its own connection: your other workspaces can use a different CRM, or none.`}
      />
      <CrmConnectionCard workspaceId={workspaceId} canManage={can("manage_settings")} syncEnabled={syncEnabled} />
    </div>
  );
}

export default function ConnectCrmPage() {
  return (
    <RequireCap anyOf={["manage_settings", "manage_integrations"]}>
      {(workspaceId) => <ConnectCrmView workspaceId={workspaceId} />}
    </RequireCap>
  );
}
