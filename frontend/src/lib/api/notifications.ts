import { api } from "./client";

export type NotificationItem = {
  key: string;
  kind: "tasks" | "review" | "returned" | "decided" | "shared" | "handoff_reply" | "changes" | "accepted";
  label: string;
  detail: string | null;
  /** Page path inside the member's own portal */
  href: string;
  count: number;
  /** When each underlying thing happened, newest first (ISO) */
  times: string[];
  /** Up to three of the actual leads/tasks, each linking straight to where it's handled */
  entries?: Array<{ label: string; href: string }>;
  /** A quieter line (e.g. the shared review queue): shown, never counted as new */
  quiet?: boolean;
};

/** When this person last read / cleared each bell group (ISO), saved on the server */
export type NotificationState = { seenAt: Record<string, string>; clearedAt: Record<string, string> };

/** The signed-in member's in-app notifications for this workspace (no email is sent). */
export function listNotifications(workspaceId: string) {
  return api<{ items: NotificationItem[]; state?: NotificationState }>(`/v1/workspaces/${workspaceId}/notifications`);
}

export function markNotifications(workspaceId: string, keys: string[], action: "read" | "clear") {
  return api<{ state: NotificationState }>(`/v1/workspaces/${workspaceId}/notifications/state`, {
    method: "POST",
    body: JSON.stringify({ keys, action }),
  });
}
