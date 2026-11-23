import { api } from "./client";
import type { Task } from "./tasks";

export type MemberTimelineEvent = {
  at: string;
  kind:
    | "research_run"
    | "evidence_reviewed"
    | "brief_submitted"
    | "accepted"
    | "returned"
    | "rejected"
    | "task_completed"
    | "task_cancelled";
  accountId: string | null;
  accountName: string | null;
  detail: string | null;
  status?: string;
};

export type MemberActivity = {
  member: { userId: string; name: string; email: string; roles: string[] };
  lastActiveAt: string | null;
  summary: { openTasks: number; overdueTasks: number; inProgressTasks: number; researchRunning: number };
  openTasks: Array<{
    id: string;
    type: Task["type"];
    status: Task["status"];
    priority: Task["priority"];
    dueAt: string | null;
    instruction: string | null;
    accountId: string;
    accountName: string | null;
    createdAt: string;
    overdue: boolean;
  }>;
  researchInProgress: Array<{
    id: string;
    mode: string;
    status: string;
    progressPct: number | null;
    accountId: string | null;
    accountName: string | null;
    label: string;
    createdAt: string;
  }>;
  timeline: MemberTimelineEvent[];
};

/** Tenant admin: what one member of the workspace is working on. */
export function getMemberActivity(workspaceId: string, userId: string) {
  return api<MemberActivity>(`/v1/workspaces/${workspaceId}/reports/members/${userId}`);
}
