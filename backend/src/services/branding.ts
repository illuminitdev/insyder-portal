/**
 * White label colours for one workspace, set by its tenant admin. Colours only: the Insyder name,
 * logo and layout stay. Any colour is allowed: the app picks white or dark text for each one, and
 * darkens a colour where it is used as text on white (see frontend lib/branding.ts).
 */
export type Branding = {
  /** Buttons, headings and strong accents */
  primary: string;
  /** Links, active states and highlights */
  accent: string;
  /** Left menu background */
  sidebar: string;
};

export const BRANDING_KEYS = ["primary", "accent", "sidebar"] as const;

const HEX = /^#[0-9a-f]{6}$/;

export function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim().toLowerCase();
  if (!s.startsWith("#")) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return HEX.test(s) ? s : null;
}

const LABEL: Record<keyof Branding, string> = { primary: "Primary colour", accent: "Accent colour", sidebar: "Menu colour" };

/** Validated branding, or a list of problems in plain words. */
export function validateBranding(input: Record<string, unknown>): { branding: Branding } | { errors: string[] } {
  const errors: string[] = [];
  const out: Partial<Branding> = {};
  for (const k of BRANDING_KEYS) {
    const hex = normalizeHex(input[k]);
    if (!hex) {
      errors.push(`${LABEL[k]} must be a hex colour like #0d1b2a`);
      continue;
    }
    out[k] = hex;
  }
  return errors.length ? { errors } : { branding: out as Branding };
}

/** Stored JSON → branding; anything invalid means "use Insyder colours". */
export function parseBranding(json: string | null | undefined): Branding | null {
  if (!json) return null;
  try {
    const r = validateBranding(JSON.parse(json) as Record<string, unknown>);
    return "branding" in r ? r.branding : null;
  } catch {
    return null;
  }
}
