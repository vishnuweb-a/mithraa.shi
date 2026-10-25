"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { signInWithGoogle } from "@/app/(auth)/actions";

const ICON = {
  mail: "M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM3.5 6.5l8.5 6 8.5-6",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 15v2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.5 3.1-6 7-6s7 2.5 7 6",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff: "M3 3l18 18M10.6 5.6A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.2 3.9M6.6 6.6A16 16 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9 9 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  arrow: "M5 12h14M13 6l6 6-6 6",
};

export function Icon({ d, size = 20 }: { d: keyof typeof ICON; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICON[d]} />
    </svg>
  );
}

type FieldProps = {
  name: string;
  label: string;
  icon: keyof typeof ICON;
  type?: string;
  autoComplete: string;
  placeholder: string;
  error?: string;
  defaultValue?: string;
  minLength?: number;
  hint?: string;
};

/** Labelled input with a leading icon. Errors are tied to the input for screen readers. */
export function Field({ name, label, icon, type = "text", error, hint, ...rest }: FieldProps) {
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={name} className="text-[14px] font-medium text-[var(--ink-2)]">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]">
          <Icon d={icon} />
        </span>
        <input
          id={name}
          name={name}
          type={isPassword && shown ? "text" : type}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`auth-input ${isPassword ? "pr-12" : ""}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            aria-controls={name}
            className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--ink)]"
          >
            <Icon d={shown ? "eye" : "eyeOff"} />
          </button>
        )}
      </div>
      {error ? (
        <p id={`${name}-error`} className="text-[13px] text-[var(--risk)]">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${name}-hint`} className="text-[12.5px] muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Primary lime action. Disabled while its form is in flight, so a double click sends one request. */
export function Submit({ children, pendingText }: { children: ReactNode; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className="auth-primary">
      {pending ? (
        <>
          <span className="spin h-4 w-4 rounded-full border-2 border-current border-t-transparent" aria-hidden />
          {pendingText}
        </>
      ) : (
        <>
          {children} <Icon d="arrow" size={18} />
        </>
      )}
    </button>
  );
}

export function Alert({ children, tone = "risk" }: { children: ReactNode; tone?: "risk" | "ok" }) {
  return (
    <p
      role={tone === "risk" ? "alert" : "status"}
      className={`rounded-[14px] px-4 py-3 text-[14px] ${tone === "risk" ? "bg-[var(--risk-soft)] text-[#ff8f9a]" : "bg-[var(--brand-soft)] text-[var(--ink)]"}`}
    >
      {children}
    </p>
  );
}

function GoogleSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="auth-secondary">
      {pending ? <span className="spin h-5 w-5 rounded-full border-2 border-white/70 border-t-transparent" aria-hidden /> : <GoogleLogo />}
      {pending ? "Opening Google…" : "Continue with Google"}
    </button>
  );
}

/** The only social sign-in. Same server action for sign-in and sign-up: Google decides if the account is new. */
export function GoogleButton({ next }: { next: string }) {
  return (
    <>
      <div className="flex items-center gap-4 text-[14px] text-[var(--muted)]">
        <span className="h-px flex-1 bg-white/10" />
        or continue with
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <GoogleSubmit />
      </form>
    </>
  );
}

function GoogleLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Sign In / Sign Up switch from the reference: two links styled as a segmented control. */
export function AuthTabs({ active, next }: { active: "login" | "signup"; next: string }) {
  const q = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return (
    <nav aria-label="Account" className="grid grid-cols-2 gap-1 rounded-[18px] border border-white/[0.08] bg-black/20 p-1">
      {(["login", "signup"] as const).map((t) => (
        <Link key={t} href={`/${t}${q}`} aria-current={active === t ? "page" : undefined} className="auth-tab">
          {t === "login" ? "Sign In" : "Sign Up"}
        </Link>
      ))}
    </nav>
  );
}
