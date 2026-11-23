"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { updateProfile } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/capabilities";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, FormError, FormNotice, inputClass } from "@/components/ui/Field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { ChangePasswordCard } from "@/components/settings/ChangePasswordCard";

/** Every role edits their own name and email here. Role and workspace access stay with the tenant admin. */
export default function ProfilePage() {
  const { user, role, workspaceName, refresh } = useWorkspace();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setEmail(user.email);
  }, [user]);

  const emailChanged = Boolean(user) && email.trim().toLowerCase() !== user!.email.toLowerCase();
  const nameChanged = Boolean(user) && name.trim() !== user!.name;
  const dirty = emailChanged || nameChanged;
  const initials = (name || user?.name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-xl space-y-6">
      <Card>
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--navy)] text-lg font-semibold text-white">
            {initials}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[20px]">{user?.name ?? "Your profile"}</h1>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {ROLE_LABELS[role ?? ""] ?? role}
              {workspaceName ? ` · ${workspaceName}` : ""}
            </p>
          </div>
        </div>

        <form
          className="mt-6 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!dirty) return;
            setBusy(true);
            setError(null);
            setNotice(null);
            try {
              await updateProfile({
                ...(nameChanged ? { name: name.trim() } : {}),
                ...(emailChanged ? { email: email.trim(), currentPassword } : {}),
              });
              setCurrentPassword("");
              await refresh();
              setNotice(emailChanged ? "Saved. Use your new email the next time you sign in." : "Saved.");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save your details");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Full name">
            <input className={inputClass} required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="Email" hint="You sign in with this email.">
            <input
              type="email"
              className={inputClass}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>
          {emailChanged ? (
            <Field label="Current password" hint="Needed to change your email.">
              <PasswordInput
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </Field>
          ) : null}

          <div className="rounded-[8px] bg-[var(--chip-bg)] px-3 py-2.5 text-xs text-[var(--muted)]">
            Your role ({ROLE_LABELS[role ?? ""] ?? role}) and which workspaces you can open are set by your tenant admin on
            the Members page.
          </div>

          <FormError message={error} />
          <FormNotice message={notice} />
          <div className="flex justify-end gap-2">
            <Button
              disabled={busy || !dirty}
              onClick={() => {
                if (!user) return;
                setName(user.name);
                setEmail(user.email);
                setCurrentPassword("");
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !dirty || (emailChanged && !currentPassword)}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Card>
      <ChangePasswordCard />
    </div>
  );
}
