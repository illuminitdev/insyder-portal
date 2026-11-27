"use client";

import { useEffect, useState } from "react";
import { initialsOf } from "@/components/accounts/AccountOverview";

/**
 * An account's logo tile: the logo found on its website on a white tile, or its initials (the
 * old tile) while there is none or if the image fails to load.
 * `tile` sets size, corners, shadow and text size; it is used for both looks.
 */
export function AccountLogo({ name, logoUrl, tile }: { name: string; logoUrl?: string | null; tile: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoUrl]);

  if (!logoUrl || failed) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center bg-gradient-to-br from-[var(--lilac)] to-[#e6e3f7] font-semibold text-[var(--foreground)] ${tile}`}
      >
        {initialsOf(name)}
      </span>
    );
  }
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden border border-[var(--card-line)] bg-white ${tile}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- outside image, any host */}
      <img
        src={logoUrl}
        alt={`${name} logo`}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-[66%] w-[66%] object-contain"
      />
    </span>
  );
}
