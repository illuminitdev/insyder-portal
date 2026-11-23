"use client";

import { useEffect, useState } from "react";
import { getAcceptanceGates } from "@/lib/api/settings";

/**
 * Whether this workspace uses the one-person workflow (Settings → Offer & targeting → Workflow):
 * the person who qualifies a lead accepts it and picks its owner, with no separate sales review.
 * False until loaded, and when it can't be loaded.
 */
export function useSkipReview(workspaceId: string | null | undefined) {
  const [skipReview, setSkipReview] = useState(false);
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    getAcceptanceGates(workspaceId)
      .then((r) => live && setSkipReview(Boolean(r.gates.skipReview)))
      .catch(() => live && setSkipReview(false));
    return () => {
      live = false;
    };
  }, [workspaceId]);
  return skipReview;
}
