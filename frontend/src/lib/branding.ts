"use client";

import { useEffect } from "react";
import { api } from "@/lib/api/client";

/** A workspace's white label colours (set by its tenant admin in Settings → Branding). */
export type Branding = { primary: string; accent: string; sidebar: string };

/** Insyder's own colours: what every workspace uses until its admin sets its own */
export const DEFAULT_BRANDING: Branding = { primary: "#0d1b2a", accent: "#0e6b67", sidebar: "#132538" };

export function getBranding(workspaceId: string) {
  return api<{ branding: Branding | null; canEdit: boolean }>(`/v1/workspaces/${workspaceId}/settings/branding`);
}

export function saveBranding(workspaceId: string, branding: Branding | null) {
  return api<{ branding: Branding | null; canEdit: boolean }>(`/v1/workspaces/${workspaceId}/settings/branding`, {
    method: "PUT",
    body: JSON.stringify({ branding }),
  });
}

export function isHex(v: string) {
  return /^#[0-9a-f]{6}$/i.test(v.trim());
}

type Rgb = [number, number, number];
const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (c: Rgb) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
/** Mix a colour towards another: pct is how much of `hex` stays */
const mixHex = (hex: string, other: string, pct: number) => {
  const a = toRgb(hex);
  const b = toRgb(other);
  return toHex(a.map((v, i) => (v * pct + b[i]! * (100 - pct)) / 100) as Rgb);
};

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = "#ffffff";
/** Dark text used on light colours (the app's own near-black) */
export const DARK_TEXT = "#0d1b2a";

/** White or dark text, whichever reads better on this colour */
export function textOn(bg: string): string {
  return contrast(WHITE, bg) >= contrast(DARK_TEXT, bg) ? WHITE : DARK_TEXT;
}

/** Text that must read on two colours at once (a gradient, or a button and its hover colour) */
function textOnBoth(a: string, b: string): string {
  const w = Math.min(contrast(WHITE, a), contrast(WHITE, b));
  const d = Math.min(contrast(DARK_TEXT, a), contrast(DARK_TEXT, b));
  return w >= d ? WHITE : DARK_TEXT;
}

/** The colour itself if it reads as text on white, otherwise the nearest darker shade that does */
export function readableOnWhite(hex: string): string {
  let c = hex;
  for (let pct = 90; contrast(c, WHITE) < 4.5 && pct >= 0; pct -= 10) c = mixHex(hex, "#000000", pct);
  return c;
}

/** Is this a light colour (so the text on it turns dark)? */
export function isLight(hex: string) {
  return textOn(hex) !== WHITE;
}

/**
 * The theme variables a branding sets (see globals.css). Any colour is allowed: text on each one
 * turns white or dark automatically, and a colour too light to read as text on white is darkened
 * wherever it is used as text (links, headings).
 */
export function brandingVars(b: Branding): Record<string, string> {
  const tint = (pct: number) => mixHex(b.accent, WHITE, pct);
  const accentText = readableOnWhite(b.accent);
  const darkMenu = !isLight(b.sidebar);
  return {
    "--brand": b.primary,
    "--navy": b.primary,
    "--brand-text": readableOnWhite(b.primary),
    "--on-brand": textOn(b.primary),
    "--brand-hover": accentText,
    "--brand-active": accentText,
    "--accent-dark": accentText,
    "--on-accent": textOn(accentText),
    "--on-gradient": textOnBoth(b.primary, accentText),
    "--accent": tint(55),
    "--brand-tint": tint(12),
    "--lilac": tint(8),
    "--brand-200": tint(30),
    "--brand-700": mixHex(accentText, "#000000", 80),
    "--link": accentText,
    "--link-200": tint(30),
    "--soft": tint(5),
    "--avatar-to": mixHex(accentText, WHITE, 80),
    // Left menu: light text on a dark menu, dark text on a light one
    "--sidebar-bg": b.sidebar,
    // The menu item you are on is drawn in the accent colour, with white or black text to match
    "--sidebar-active": b.accent,
    "--sidebar-active-text": textOn(b.accent),
    "--sidebar-active-icon": textOn(b.accent),
    "--sidebar-text": darkMenu ? "#c3ced9" : "#34404f",
    "--sidebar-muted": darkMenu ? "#8fa2b5" : "#566070",
    "--sidebar-strong": darkMenu ? WHITE : DARK_TEXT,
    "--sidebar-accent": darkMenu ? tint(55) : accentText,
    "--sidebar-hover": darkMenu ? "rgba(255, 255, 255, 0.08)" : "rgba(13, 27, 42, 0.06)",
    "--sidebar-card": darkMenu ? "rgba(255, 255, 255, 0.06)" : "rgba(13, 27, 42, 0.05)",
    "--sidebar-border": darkMenu ? "rgba(255, 255, 255, 0.1)" : "rgba(13, 27, 42, 0.1)",
  };
}

const CHANGED = "insyder:branding-changed";
const cacheKey = (workspaceId: string) => `insyder:branding:${workspaceId}`;

function readCache(workspaceId: string): Branding | null {
  try {
    const v = localStorage.getItem(cacheKey(workspaceId));
    return v ? (JSON.parse(v) as Branding) : null;
  } catch {
    return null;
  }
}

function writeCache(workspaceId: string, b: Branding | null) {
  try {
    if (b) localStorage.setItem(cacheKey(workspaceId), JSON.stringify(b));
    else localStorage.removeItem(cacheKey(workspaceId));
  } catch {
    // storage unavailable: colours just load a moment later
  }
}

function apply(b: Branding | null) {
  const root = document.documentElement.style;
  for (const k of Object.keys(brandingVars(DEFAULT_BRANDING))) root.removeProperty(k);
  if (b) for (const [k, v] of Object.entries(brandingVars(b))) root.setProperty(k, v);
}

/** Tell the app shell that this workspace's colours changed (after saving in Settings). */
export function announceBranding(workspaceId: string, b: Branding | null) {
  writeCache(workspaceId, b);
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: { workspaceId, branding: b } }));
}

/**
 * Draws the signed-in app in the current workspace's colours. Only the workspace shell uses this,
 * so other workspaces, other companies and the platform console keep their own colours.
 */
export function useWorkspaceBranding(workspaceId: string | null | undefined) {
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    // Last known colours first, so the page doesn't flash Insyder colours on every load
    apply(readCache(workspaceId));
    getBranding(workspaceId)
      .then((r) => {
        if (!live) return;
        writeCache(workspaceId, r.branding);
        apply(r.branding);
      })
      .catch(() => undefined);
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<{ workspaceId: string; branding: Branding | null }>).detail;
      if (d.workspaceId === workspaceId) apply(d.branding);
    };
    window.addEventListener(CHANGED, onChange);
    return () => {
      live = false;
      window.removeEventListener(CHANGED, onChange);
      apply(null);
    };
  }, [workspaceId]);
}
