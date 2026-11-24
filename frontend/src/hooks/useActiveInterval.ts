"use client";

import { useEffect, useRef } from "react";

const IDLE_AFTER_MS = 15 * 60_000;
const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"] as const;

/**
 * Like setInterval, but only ticks while the tab is visible and the user had input in the last
 * 15 minutes, so an idle open tab stops querying the backend (and lets the database sleep).
 * When the tab becomes visible again, or the user comes back after being idle, the callback runs at once.
 */
export function useActiveInterval(callback: () => void, ms: number, enabled = true) {
  const cb = useRef(callback);
  useEffect(() => {
    cb.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    let lastInputAt = Date.now();
    let missed = false; // a tick was skipped while hidden or idle

    const isActive = () =>
      document.visibilityState === "visible" && Date.now() - lastInputAt < IDLE_AFTER_MS;

    const t = setInterval(() => {
      if (isActive()) cb.current();
      else missed = true;
    }, ms);

    const onInput = () => {
      const wasIdle = Date.now() - lastInputAt >= IDLE_AFTER_MS;
      lastInputAt = Date.now();
      if ((wasIdle || missed) && document.visibilityState === "visible") {
        missed = false;
        cb.current();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      missed = false;
      lastInputAt = Date.now();
      cb.current();
    };

    for (const e of INPUT_EVENTS) window.addEventListener(e, onInput, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(t);
      for (const e of INPUT_EVENTS) window.removeEventListener(e, onInput);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, enabled]);
}
