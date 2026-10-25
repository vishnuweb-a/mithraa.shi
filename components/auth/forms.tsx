"use client";

import { useActionState, ViewTransition, type ReactNode } from "react";
import Link from "next/link";
import { requestPasswordReset, signIn, signUp, updatePassword, type FormState } from "@/app/(auth)/actions";
import { Alert, AuthTabs, Field, GoogleButton, Submit } from "./fields";

const PASSWORD_HINT = "At least 8 characters, with letters and numbers.";
const SHORT_HINT = "8+ chars, letters and numbers"; // fits one line of the half-width sign-up column

// Sign In <-> Sign Up: the form body slides toward the tab picked (types set by the links). Anything untyped
// (the streamed reveal on page load, Back/Forward, leaving for the workspace) just swaps, so nothing blocks clicks.
// Tabs, card and artwork stay outside it so they hold still; CSS in globals.css.
const SWAP = { "auth-forward": "auth-forward", "auth-back": "auth-back", default: "none" };

function Heading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="auth-title">{title}</h1>
      {children && <p className="text-[15px] text-[var(--ink-2)] sm:text-[16px]">{children}</p>}
    </header>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <p className="text-center text-[15px] text-[var(--ink-2)]">{children}</p>;
}

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action] = useActionState(signIn, {} as FormState);
  const error = state.error ?? (state.fields ? undefined : notice);
  // fragment, not a wrapper: <ViewTransition> must come before any DOM node for its enter/exit to fire
  return (
    <>
      <AuthTabs active="login" next={next} />
      <ViewTransition enter={SWAP} exit={SWAP} default="none">
        <div className="flex flex-col gap-5">
          <Heading title="Welcome back!">
            Continue your creative journey with <span className="text-[var(--brand)]">mithraa.SHI</span>
          </Heading>
          {error && <Alert>{error}</Alert>}
          <form action={action} noValidate className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next} />
            <Field name="email" label="Email address" icon="mail" type="email" autoComplete="email" placeholder="you@studio.com" defaultValue={state.email} error={state.fields?.email} />
            <Field name="password" label="Password" icon="lock" type="password" autoComplete="current-password" placeholder="Enter your password" error={state.fields?.password} />
            <div className="-mt-1 flex justify-end">
              <Link href="/forgot-password" className="auth-link text-[14.5px]">
                Forgot password?
              </Link>
            </div>
            <Submit pendingText="Signing in…">Sign In</Submit>
          </form>
          <GoogleButton next={next} />
          <Footer>
            Don&apos;t have an account?{" "}
            <Link href={next === "/" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`} prefetch transitionTypes={["auth-forward"]} className="auth-link">
              Sign up now
            </Link>
          </Footer>
        </div>
      </ViewTransition>
    </>
  );
}

export function SignupForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUp, {} as FormState);
  if (state.sent) {
    return (
      <div className="flex flex-col gap-5" data-testid="verify-pending">
        <Heading title="Check your email">
          We sent a confirmation link to <strong className="text-[var(--ink)]">{state.email}</strong>. Open it on this device to finish creating your
          account. Your account stays unconfirmed until you do.
        </Heading>
        <Alert tone="ok">Nothing there after a few minutes? Check spam, or sign up again to resend.</Alert>
        <Footer>
          Already confirmed?{" "}
          <Link href="/login" className="auth-link">
            Sign in
          </Link>
        </Footer>
      </div>
    );
  }
  return (
    <>
      <AuthTabs active="signup" next={next} />
      <ViewTransition enter={SWAP} exit={SWAP} default="none">
        {/* tighter than sign in and passwords paired from sm up, so it fits the card height sign in already sets */}
        <div className="flex flex-col gap-4">
          <Heading
            title={
              <>
                Create your <span className="auth-gradient-text">account</span>
              </>
            }
          />
          {state.error && <Alert>{state.error}</Alert>}
          <form action={action} noValidate className="flex flex-col gap-3">
            <input type="hidden" name="next" value={next} />
            <Field name="name" label="Full name" icon="user" autoComplete="name" placeholder="Enter your full name" defaultValue={state.name} error={state.fields?.name} />
            <Field name="email" label="Email" icon="mail" type="email" autoComplete="email" placeholder="you@studio.com" defaultValue={state.email} error={state.fields?.email} />
            <div className="grid items-start gap-3 sm:grid-cols-2">
              <Field name="password" label="Password" icon="lock" type="password" autoComplete="new-password" placeholder="Create one" minLength={8} hint={SHORT_HINT} error={state.fields?.password} />
              <Field name="confirm" label="Confirm password" icon="lock" type="password" autoComplete="new-password" placeholder="Repeat it" error={state.fields?.confirm} />
            </div>
            <Submit pendingText="Creating account…">Create Account</Submit>
          </form>
          <GoogleButton next={next} />
          <Footer>
            Already have an account?{" "}
            <Link href={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`} prefetch transitionTypes={["auth-back"]} className="auth-link">
              Sign In
            </Link>
          </Footer>
        </div>
      </ViewTransition>
    </>
  );
}

export function ForgotForm() {
  const [state, action] = useActionState(requestPasswordReset, {} as FormState);
  return (
    <div className="flex flex-col gap-5">
      <Heading title="Reset your password">Enter the email you sign in with and we&apos;ll send you a link to choose a new password.</Heading>
      {state.sent ? (
        <Alert tone="ok">
          If an account exists for <strong>{state.email}</strong>, a reset link is on its way. It works once, on this device, for one hour.
        </Alert>
      ) : (
        <>
          {state.error && <Alert>{state.error}</Alert>}
          <form action={action} noValidate className="flex flex-col gap-4">
            <Field name="email" label="Email address" icon="mail" type="email" autoComplete="email" placeholder="you@studio.com" defaultValue={state.email} error={state.fields?.email} />
            <Submit pendingText="Sending…">Send reset link</Submit>
          </form>
        </>
      )}
      <Footer>
        Remembered it?{" "}
        <Link href="/login" className="auth-link">
          Back to sign in
        </Link>
      </Footer>
    </div>
  );
}

export function ResetForm() {
  const [state, action] = useActionState(updatePassword, {} as FormState);
  return (
    <div className="flex flex-col gap-5">
      <Heading title="Choose a new password">You opened a valid reset link. Pick a new password for your account.</Heading>
      {state.error && <Alert>{state.error}</Alert>}
      <form action={action} noValidate className="flex flex-col gap-4">
        <Field name="password" label="New password" icon="lock" type="password" autoComplete="new-password" placeholder="Create a strong password" minLength={8} hint={PASSWORD_HINT} error={state.fields?.password} />
        <Field name="confirm" label="Confirm new password" icon="lock" type="password" autoComplete="new-password" placeholder="Type it again" error={state.fields?.confirm} />
        <Submit pendingText="Saving…">Save password</Submit>
      </form>
    </div>
  );
}
