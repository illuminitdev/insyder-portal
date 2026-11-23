"use client";

import { useCallback, useEffect, useRef } from "react";
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import type { PortalSection } from "../layout/portals";

/** Fire this to replay the tour from anywhere (e.g. the "Take the tour" button on How it works). */
export const START_TOUR_EVENT = "insyder:start-tour";
export const startProductTour = () => window.dispatchEvent(new Event(START_TOUR_EVENT));

/** Bump to show the tour again to everyone after it changes a lot. */
const TOUR_VERSION = 1;
const seenKey = (userId: string, portal: string) => `insyder:tour:v${TOUR_VERSION}:${userId}:${portal}`;

/** What each menu section is for. Role-specific text where the same section means different work. */
const SECTION_TEXT: Record<string, string | Partial<Record<string, string>>> = {
  overview: "Your home page: the numbers and to-dos that matter for your role, at a glance.",
  discover: {
    admin: "Find companies showing buying signals (expansion, hiring, refresh, tenders) and assign them to researchers. Playbooks hold the search rules.",
    researcher: "Search the web for companies showing a buying signal and add the promising ones to your leads.",
    default: "Find companies showing buying signals.",
  },
  leads: "Leads assigned to you: qualify them with evidence, then send them for review.",
  accounts: {
    admin: "Every account in this workspace: imports (CSV or your CRM), the pipeline, qualifying, review and sending to your CRM.",
    researcher: "Your watchlist and imports, and the pipeline.",
    reviewer: "The pipeline and watchlist of accounts.",
    sdr: "Accounts you own or have tasks on, and the pipeline.",
    default: "Accounts in this workspace.",
  },
  monitors: "Signal monitors: automated schedules watching your target accounts and playbooks for new buying signals and evidence.",
  review: "Briefs waiting for your decision: accept, return for more research, or reject. Oldest first is a good habit.",
  work: "Your task queue. Do the next task and record the outcome. Nothing is ever sent automatically.",
  outreach: "Tasks, drafts and your work queue. Drafts are never sent automatically.",
  members: "Invite people and give each one a role: researcher, sales reviewer, SDR, analyst or partner.",
  workspaces: "Each workspace has its own accounts, offer, settings, users and CRM connection.",
  reports: "Outcomes: which researched leads became pipeline and revenue.",
  shared: "Handoffs shared with you. You only see the fields that were shared.",
  settings: "Your profile and password, and the settings your role can change. How it works explains your workflow step by step.",
};

function textFor(key: string, portal: string) {
  const t = SECTION_TEXT[key];
  if (!t) return "";
  if (typeof t === "string") return t;
  return t[portal] ?? t.default ?? "";
}

const exists = (selector: string) => Boolean(document.querySelector(selector));

function buildSteps(portalKey: string, portalLabel: string, sections: PortalSection[], userName: string | null): DriveStep[] {
  const steps: DriveStep[] = [
    {
      popover: {
        title: `Welcome to Insyder${userName ? `, ${userName.split(/\s+/)[0]}` : ""}`,
        description: `A quick tour of your ${portalLabel} workspace. It takes under a minute; skip it any time.`,
      },
    },
  ];
  if (exists('[data-tour="workspace"]')) {
    steps.push({
      element: '[data-tour="workspace"]',
      popover: {
        title: "Your workspace",
        description: "Everything you see belongs to this workspace. If you're in more than one, switch here.",
        side: "right",
        align: "start",
      },
    });
  }
  for (const s of sections) {
    const selector = `[data-tour="nav-${s.key}"]`;
    const description = textFor(s.key, portalKey);
    if (!description || !exists(selector)) continue;
    steps.push({ element: selector, popover: { title: s.label, description, side: "right", align: "center" } });
  }
  if (exists('[data-tour="crm-chip"] a')) {
    steps.push({
      element: '[data-tour="crm-chip"] a',
      popover: { title: "Your CRM", description: "Which CRM this workspace sends leads to, and whether the connection is healthy.", side: "bottom", align: "end" },
    });
  }
  if (exists('[data-tour="bell"]')) {
    steps.push({
      element: '[data-tour="bell"]',
      popover: { title: "Needs your attention", description: "Overdue tasks, briefs waiting for review and other things to act on.", side: "bottom", align: "end" },
    });
  }
  if (exists('[data-tour="help"]')) {
    steps.push({
      element: '[data-tour="help"]',
      popover: {
        title: "Help is here",
        description: "Open this menu for How it works, your profile and Log out. You can replay this tour from How it works.",
        side: "bottom",
        align: "end",
      },
    });
  }
  return steps;
}

/**
 * First-login product tour: highlights the sidebar and top bar one step at a time with Next / Back / Skip.
 * Shown once per user and portal on this browser (desktop widths only, where the sidebar is visible).
 */
export function ProductTour({
  userId,
  userName,
  portalKey,
  portalLabel,
  sections,
}: {
  userId: string | null;
  userName: string | null;
  portalKey: string;
  portalLabel: string;
  sections: PortalSection[];
}) {
  const active = useRef<Driver | null>(null);
  // Latest menu and name without restarting timers on every render (the sections array is rebuilt each time)
  const latest = useRef({ sections, userName, portalLabel });
  latest.current = { sections, userName, portalLabel };

  const start = useCallback(() => {
    if (!userId || active.current) return;
    const { sections: secs, userName: name, portalLabel: label } = latest.current;
    const steps = buildSteps(portalKey, label, secs, name);
    if (steps.length < 2) return;
    const markSeen = () => {
      try {
        localStorage.setItem(seenKey(userId, portalKey), new Date().toISOString());
      } catch {
        /* private mode: the tour may show again, that's fine */
      }
    };
    const d = driver({
      steps,
      showProgress: true,
      progressText: "{{current}} of {{total}}",
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      showButtons: ["next", "previous", "close"],
      allowClose: true,
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 10,
      popoverClass: "insyder-tour",
      onPopoverRender: (popover, { driver: drv }) => {
        // A visible "Skip tour" button next to Back/Next (the × also closes it)
        if (drv.isLastStep()) return;
        const skip = document.createElement("button");
        skip.type = "button";
        skip.textContent = "Skip tour";
        skip.className = "insyder-tour-skip";
        skip.addEventListener("click", () => drv.destroy());
        popover.footerButtons.prepend(skip);
      },
      onDestroyed: () => {
        markSeen();
        active.current = null;
      },
    });
    active.current = d;
    d.drive();
  }, [userId, portalKey]);

  // First visit: start once the shell has rendered (desktop only; on mobile the sidebar is a hidden drawer)
  useEffect(() => {
    if (!userId) return;
    let seen = false;
    try {
      seen = Boolean(localStorage.getItem(seenKey(userId, portalKey)));
    } catch {
      seen = true;
    }
    if (seen || window.innerWidth < 1024) return;
    const t = window.setTimeout(start, 900);
    return () => window.clearTimeout(t);
  }, [userId, portalKey, start]);

  // Replays
  useEffect(() => {
    const onStart = () => start();
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, [start]);

  useEffect(() => () => active.current?.destroy(), []);

  return null;
}
