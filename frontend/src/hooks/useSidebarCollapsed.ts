"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "insyder:sidebar-collapsed";
const EVENT = "insyder:sidebar-collapsed-changed";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  // Another tab changed it
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Whether the left menu is closed on desktop, so the page can use the whole screen. Remembered in this
 * browser and shared by every portal; phones keep their slide-out menu either way.
 */
export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);
  const setCollapsed = useCallback((next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // storage unavailable: the menu simply stays open
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [collapsed, setCollapsed] as const;
}
