"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";

/**
 * A company's logo in a round tile, loaded from the address found on its website.
 * Shows the globe while there is no address, and if the image fails to load.
 */
export function SiteLogo({ src, size = 40, alt = "" }: { src?: string | null; size?: number; alt?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand-text)]"
        style={{ width: size, height: size }}
      >
        <Globe size={Math.round(size / 2)} strokeWidth={1.75} aria-hidden />
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--line)] bg-white"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- outside image, any host */}
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(true)}
        className="object-contain"
        style={{ width: Math.round(size * 0.7), height: Math.round(size * 0.7) }}
      />
    </span>
  );
}
