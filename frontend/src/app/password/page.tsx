"use client";

import { ChangePasswordCard } from "@/components/settings/ChangePasswordCard";

/** Forced password change (temporary password): reachable before any portal is chosen. */
export default function ForcedPasswordPage() {
  return (
    <div className="max-w-md">
      <ChangePasswordCard />
    </div>
  );
}
