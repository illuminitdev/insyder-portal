"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, requestAccess } from "@/lib/auth/session";
import { ArrowRight, Building2, Lock, Mail, User } from "lucide-react";

type Mode = "login" | "register" | "forgot";

/** New customers choose a plan and pay on the marketing site's Pricing page; their login is emailed to them. */
const PRICING_URL = `${(process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3001").replace(/\/+$/, "")}/pricing`;

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M3 3l18 18M10.5 10.5a2.5 2.5 0 003 3M9.9 5.1A10 10 0 0112 5c4.8 0 8.9 3 10.5 7.2a11 11 0 01-4 4.8M6.2 6.2A11 11 0 001.5 12.2C3.1 16.4 7.2 19.5 12 19.5c1.5 0 2.9-.3 4.2-.8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12.2C3.6 8 7.7 5 12 5s8.4 3 10 7.2c-1.6 4.2-5.7 7.2-10 7.2S3.6 16.4 2 12.2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.2" r="2.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [requested, setRequested] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const title =
    mode === "login" ? "Welcome back" : mode === "register" ? "Create account" : "Reset password";
  const subtitle =
    mode === "login"
      ? "Sign in to continue to your workspace."
      : mode === "register"
        ? "Request access to join your company workspace."
        : "Enter your email and we’ll help you recover access.";

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
    setShowPassword(false);
    setRequested(false);
  }

  return (
    <div className="auth-form">
      <header className="auth-form__header">
        <h1 className="auth-form__title">{title}</h1>
        <p className="auth-form__subtitle">{subtitle}</p>
      </header>

      <div className="auth-card">
        <form
          className="auth-form__fields"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            setInfo(null);
            try {
              if (mode === "login") {
                const { user } = await login(email, password);
                router.push(
                  user.mustChangePassword ? "/password" : user.isPlatformAdmin ? "/platform" : "/home",
                );
                return;
              }
              if (mode === "register") {
                await requestAccess({ name, email, companyName, password });
                setRequested(true);
                setInfo(
                  "Request sent. We’ll review it shortly — once it’s approved, log in with this email and password.",
                );
                return;
              }
              setInfo("Password reset isn’t available yet. Contact your workspace admin.");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Something went wrong");
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "register" ? (
            <label className="auth-field">
              <span className="auth-field__label">Full name</span>
              <span className="auth-field__control">
                <User size={17} strokeWidth={1.6} className="auth-field__icon" aria-hidden />
                <input
                  className="auth-field__input auth-field__input--lead"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Morgan"
                  autoComplete="name"
                  required
                />
              </span>
            </label>
          ) : null}

          <label className="auth-field">
            <span className="auth-field__label">Email Address</span>
            <span className="auth-field__control">
              <Mail size={17} strokeWidth={1.6} className="auth-field__icon" aria-hidden />
              <input
                className="auth-field__input auth-field__input--lead"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                required
              />
            </span>
          </label>

          {mode === "register" ? (
            <label className="auth-field">
              <span className="auth-field__label">Company</span>
              <span className="auth-field__control">
                <Building2 size={17} strokeWidth={1.6} className="auth-field__icon" aria-hidden />
                <input
                  className="auth-field__input auth-field__input--lead"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Ltd"
                  autoComplete="organization"
                  required
                />
              </span>
            </label>
          ) : null}

          {mode !== "forgot" ? (
            <div className="auth-field">
              <label htmlFor="auth-password" className="auth-field__label">
                Password
              </label>
              <div className="auth-field__control">
                <Lock size={17} strokeWidth={1.6} className="auth-field__icon" aria-hidden />
                <input
                  id="auth-password"
                  className="auth-field__input auth-field__input--lead auth-field__input--icon"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "register" ? "At least 8 characters" : "Enter your password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  minLength={mode === "register" ? 8 : undefined}
                />
                <button
                  type="button"
                  className="auth-field__eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="auth-msg auth-msg--error" role="alert">
              {error}
            </p>
          ) : null}
          {info ? <p className="auth-msg">{info}</p> : null}

          <button type="submit" className="auth-submit" disabled={busy || (mode === "register" && requested)}>
            {busy
              ? "Please wait…"
              : mode === "login"
                ? <>Log in <ArrowRight size={16} strokeWidth={2} aria-hidden /></>
                : mode === "register"
                  ? requested
                    ? "Request sent"
                    : <>Request access <ArrowRight size={16} strokeWidth={2} aria-hidden /></>
                  : "Continue"}
          </button>

          {mode === "login" ? (
            <div className="mt-2 text-center">
              <button
                type="button"
                className="auth-link font-normal text-[12px] text-[#475467] hover:text-[var(--brand-active)]"
                onClick={() => switchMode("forgot")}
              >
                Forgot password?
              </button>
            </div>
          ) : null}
        </form>

        <p className="auth-form__footer">
          {mode === "forgot" ? (
            <>
              Remembered it?{" "}
              <button type="button" className="auth-link text-[var(--brand)] font-semibold" onClick={() => switchMode("login")}>
                Back to log in
              </button>
            </>
          ) : mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <a className="auth-link text-[var(--brand)] font-semibold" href={PRICING_URL}>
                Sign up
              </a>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button type="button" className="auth-link text-[var(--brand)] font-semibold" onClick={() => switchMode("login")}>
                Log in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
