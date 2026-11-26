import { getEnv, portalUrl } from "../config/env.js";

export function isEmailConfigured() {
  return Boolean(getEnv().RESEND_API_KEY.trim());
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Sends one email through Resend (https://resend.com). Returns false instead of throwing, so a
 * mail outage never undoes the work that triggered it; callers record that it wasn't sent.
 * Without RESEND_API_KEY nothing is sent and only the recipient and subject are logged.
 */
export async function sendEmail(msg: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  const env = getEnv();
  if (!isEmailConfigured()) {
    console.warn(`[email] RESEND_API_KEY not set; not sent to ${msg.to}: "${msg.subject}"`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[email] Resend rejected the email to ${msg.to} (HTTP ${res.status}): ${await res.text().catch(() => "")}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] Could not reach Resend for ${msg.to}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Login details for a new company admin: their email and a temporary password they must change at first login. */
export function loginDetailsEmail(input: { name: string; email: string; tempPassword: string; planName: string; companyName: string }) {
  const login = `${portalUrl()}/login`;
  const first = input.name.split(" ")[0] || input.name;
  const subject = "Your Insyder login details";
  const text = [
    `Hi ${first},`,
    "",
    `Thanks for choosing the Insyder ${input.planName} plan. Your workspace for ${input.companyName} is ready.`,
    "",
    `Log in: ${login}`,
    `Email: ${input.email}`,
    `Temporary password: ${input.tempPassword}`,
    "",
    "You'll be asked to choose your own password when you first log in.",
    "",
    "The Insyder team",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#F5F2EA;font-family:Arial,Helvetica,sans-serif;color:#0D1B2A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0D1B2A;padding:22px 28px;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px">insyder</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 14px;font-size:16px">Hi ${escapeHtml(first)},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.55">Thanks for choosing the Insyder <b>${escapeHtml(input.planName)}</b> plan. Your workspace for <b>${escapeHtml(input.companyName)}</b> is ready.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#F5F2EA;border-radius:10px;margin:0 0 22px">
<tr><td style="padding:16px 18px;font-size:14px;line-height:1.8">
<span style="color:#5B6777">Email</span><br><b>${escapeHtml(input.email)}</b><br>
<span style="color:#5B6777">Temporary password</span><br><b style="font-family:Consolas,Menlo,monospace;font-size:16px;letter-spacing:0.5px">${escapeHtml(input.tempPassword)}</b>
</td></tr></table>
<a href="${login}" style="display:inline-block;background:#7FD3CB;color:#0D1B2A;text-decoration:none;font-weight:700;font-size:15px;padding:13px 24px;border-radius:999px">Log in to Insyder</a>
<p style="margin:22px 0 0;font-size:13px;line-height:1.55;color:#5B6777">You'll be asked to choose your own password when you first log in. If you didn't sign up for Insyder, you can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { to: input.email, subject, text, html };
}
