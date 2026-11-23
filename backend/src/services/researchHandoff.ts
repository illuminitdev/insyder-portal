import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { accounts, evidence, memberships, tasks } from "../db/schema/index.js";
import type { MembershipRole } from "../db/schema/identity.js";
import { forbidden, notFound, validationError } from "../utils/errors.js";
import { transitionAcceptance } from "./acceptance.js";
import { getOrCreateQualification, updateQualification } from "./qualification.js";
import { createTask, getTask, updateTask } from "./tasks.js";

/** Roles that can decide on a brief, so a lead can be sent to them for review */
export const REVIEWER_ROLES: MembershipRole[] = ["sales_reviewer", "tenant_admin"];

async function assertReviewer(workspaceId: string, userId: string) {
  const [row] = await getDb()
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId), isNull(memberships.revokedAt)))
    .limit(1);
  if (!row) throw validationError("Reviewer must be an active workspace member");
  if (!REVIEWER_ROLES.includes(row.role)) throw validationError("Choose a sales reviewer");
}

/**
 * The shared part of sending a lead to a named reviewer: save the note as the rationale,
 * move the account to Ready for review and give the reviewer a Sales review task. Each step
 * is skipped if it already happened, so a retry after a partial failure finishes the job
 * instead of duplicating it.
 */
async function handOff(input: {
  tenantId: string;
  workspaceId: string;
  accountId: string;
  note: string;
  reviewerUserId: string;
  actorUserId: string;
  role: MembershipRole;
  timezone?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  idempotencyKey?: string;
}) {
  const note = input.note.trim();
  if (!note) throw validationError("Write a short note for the reviewer");
  await assertReviewer(input.workspaceId, input.reviewerUserId);

  const db = getDb();
  // The reviewer can only accept with reviewed evidence, so require it before handing over
  const reviewed = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(
        eq(evidence.accountId, input.accountId),
        eq(evidence.workspaceId, input.workspaceId),
        isNotNull(evidence.reviewedAt),
      ),
    )
    .limit(1);
  if (!reviewed[0]) {
    throw validationError("Mark at least one evidence item as reviewed on the account brief first");
  }

  const qual = await getOrCreateQualification(input.tenantId, input.workspaceId, input.accountId);
  if (qual.rationale !== note) {
    await updateQualification({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      accountId: input.accountId,
      expectedVersion: qual.version,
      rationale: note,
      actorUserId: input.actorUserId,
    });
  }

  const [account] = await db
    .select({ acceptanceState: accounts.acceptanceState })
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.workspaceId, input.workspaceId)))
    .limit(1);
  if (!account) throw notFound("Account not found");
  if (account.acceptanceState === "draft" || account.acceptanceState === "needs_research") {
    await transitionAcceptance({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      accountId: input.accountId,
      toState: "ready_for_review",
      actorUserId: input.actorUserId,
      role: input.role,
    });
  } else if (account.acceptanceState !== "ready_for_review") {
    throw validationError(`This account is already ${account.acceptanceState.replace(/_/g, " ")}`);
  }

  // Already waiting with an open review task for this reviewer (a retry): don't make a second one
  const [openReview] = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, input.workspaceId),
        eq(tasks.accountId, input.accountId),
        eq(tasks.type, "review"),
        eq(tasks.ownerUserId, input.reviewerUserId),
        inArray(tasks.status, ["open", "in_progress"]),
      ),
    )
    .limit(1);
  const reviewTask =
    openReview ??
    (await createTask({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      accountId: input.accountId,
      type: "review",
      ownerUserId: input.reviewerUserId,
      timezone: input.timezone,
      instruction: note,
      priority: input.priority ?? "normal",
      idempotencyKey: input.idempotencyKey,
      createdBy: input.actorUserId,
    }));
  return { reviewTask };
}

/** Send a research task's lead to a named reviewer and complete the research task. */
export async function sendResearchForReview(input: {
  tenantId: string;
  workspaceId: string;
  taskId: string;
  note: string;
  reviewerUserId: string;
  actorUserId: string;
  role: MembershipRole;
}) {
  const task = await getTask(input.tenantId, input.workspaceId, input.taskId);
  if (task.type !== "research") throw validationError("Only research tasks can be sent for review");
  if (input.role !== "tenant_admin" && task.ownerUserId !== input.actorUserId) {
    throw forbidden("You can only send your own tasks for review");
  }
  if (task.status === "completed" || task.status === "cancelled") {
    throw validationError("This task is already finished");
  }

  const { reviewTask } = await handOff({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    accountId: task.accountId,
    note: input.note,
    reviewerUserId: input.reviewerUserId,
    actorUserId: input.actorUserId,
    role: input.role,
    timezone: task.timezone,
    priority: task.priority as "low" | "normal" | "high" | "urgent",
    idempotencyKey: `handoff-${task.id}`,
  });

  const researchTask = await updateTask({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    taskId: task.id,
    status: "completed",
    outcome: `Sent to sales review: ${input.note.trim()}`,
    actorUserId: input.actorUserId,
  });

  return { researchTask, reviewTask };
}

/** Send a lead that has no research task to a named reviewer. */
export async function sendLeadForReview(input: {
  tenantId: string;
  workspaceId: string;
  accountId: string;
  note: string;
  reviewerUserId: string;
  actorUserId: string;
  role: MembershipRole;
}) {
  return handOff(input);
}
