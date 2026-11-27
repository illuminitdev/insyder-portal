/**
 * Feature switches. Plans, pricing and plan limits are hidden for demos:
 * set NEXT_PUBLIC_SHOW_PLANS=true (and PLANS_ENFORCED=true on the backend) to bring them back.
 */
export const SHOW_PLANS = process.env.NEXT_PUBLIC_SHOW_PLANS === "true";
