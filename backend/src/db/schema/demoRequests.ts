import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const demoRequestStatuses = ["new", "contacted", "closed"] as const;
export type DemoRequestStatus = (typeof demoRequestStatuses)[number];

/**
 * "Book a demo" form submissions from the marketing site. The marketing site's /api/demo-requests route forwards each
 * one here (server to server, with DEMO_INTAKE_KEY); the platform admin follows them up.
 */
export const demoRequests = pgTable(
  "demo_requests",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    company: text("company"),
    role: text("role"),
    website: text("website"),
    message: text("message"),
    status: text("status").notNull().$type<DemoRequestStatus>().default("new"),
    /** Who last changed the status, and when */
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("demo_requests_status_idx").on(t.status, t.createdAt)],
);
