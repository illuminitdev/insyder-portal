import { count, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { demoRequests, users, type DemoRequestStatus } from "../db/schema/index.js";
import { newId } from "../utils/ids.js";
import { notFound } from "../utils/errors.js";

export type DemoRequestInput = {
  name: string;
  email: string;
  company?: string;
  role?: string;
  website?: string;
  message?: string;
};

/** Save a "Book a demo" submission forwarded by the marketing site. */
export async function createDemoRequest(input: DemoRequestInput) {
  const id = newId("demo");
  const blank = (v?: string) => v?.trim() || null;
  await getDb()
    .insert(demoRequests)
    .values({
      id,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      company: blank(input.company),
      role: blank(input.role),
      website: blank(input.website),
      message: blank(input.message),
      status: "new",
    });
  return { id };
}

/** Platform admin view, newest first, with a count per status. */
export async function listDemoRequests(status?: DemoRequestStatus) {
  const db = getDb();
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: demoRequests.id,
        name: demoRequests.name,
        email: demoRequests.email,
        company: demoRequests.company,
        role: demoRequests.role,
        website: demoRequests.website,
        message: demoRequests.message,
        status: demoRequests.status,
        updatedByName: users.name,
        createdAt: demoRequests.createdAt,
        updatedAt: demoRequests.updatedAt,
      })
      .from(demoRequests)
      .leftJoin(users, eq(users.id, demoRequests.updatedBy))
      .where(status ? eq(demoRequests.status, status) : undefined)
      .orderBy(desc(demoRequests.createdAt)),
    db.select({ status: demoRequests.status, n: count() }).from(demoRequests).groupBy(demoRequests.status),
  ]);
  const byStatus = new Map(counts.map((c) => [c.status, Number(c.n)]));
  return {
    counts: { new: byStatus.get("new") ?? 0, contacted: byStatus.get("contacted") ?? 0, closed: byStatus.get("closed") ?? 0 },
    requests: rows,
  };
}

/** Move a request along: new → contacted → closed (or back). */
export async function setDemoRequestStatus(id: string, status: DemoRequestStatus, actorUserId: string) {
  const [row] = await getDb()
    .update(demoRequests)
    .set({ status, updatedBy: actorUserId, updatedAt: new Date() })
    .where(eq(demoRequests.id, id))
    .returning({ id: demoRequests.id });
  if (!row) throw notFound("Demo request not found");
}
