"use client";

import { useActionState, type ReactNode } from "react";
import Link from "next/link";
import { requestPasswordReset, signIn, signUp, updatePassword, type FormState } from "@/app/(auth)/actions";
import { Alert, AuthTabs, Field, GoogleButton, Submit } from "./fields";

const PASSWORD_HINT = "At least 8 characters, with letters and numbers.";

function Heading({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="auth-title">{title}</h1>
      <p className="text-[15px] text-[var(--ink-2)] sm:text-[16px]">{children}</p>
    </header>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <p className="text-center text-[15px] text-[var(--ink-2)]">{children}</p>;
}

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action] = useActionState(signIn, {} as FormState);
  const error = state.error ?? (state.fields ? undefined : notice);
  return (
    <div className="flex flex-col gap-5">
      <AuthTabs active="login" next={next} />
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
        <Link href={next === "/" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`} className="auth-link">
          Sign up now
        </Link>
      </Footer>
    </div>
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
    <div className="flex flex-col gap-5">
      <AuthTabs active="signup" next={next} />
      <Heading
        title={
          <>
            Create your <span className="auth-gradient-text">account</span>
          </>
        }
      >
        Join mithraa.SHI and start making films with AI agents and your crew.
      </Heading>
      {state.error && <Alert>{state.error}</Alert>}
      <form action={action} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <Field name="name" label="Full name" icon="user" autoComplete="name" placeholder="Enter your full name" defaultValue={state.name} error={state.fields?.name} />
        <Field name="email" label="Email" icon="mail" type="email" autoComplete="email" placeholder="you@studio.com" defaultValue={state.email} error={state.fields?.email} />
        <Field name="password" label="Password" icon="lock" type="password" autoComplete="new-password" placeholder="Create a strong password" minLength={8} hint={PASSWORD_HINT} error={state.fields?.password} />
        <Field name="confirm" label="Confirm password" icon="lock" type="password" autoComplete="new-password" placeholder="Type it again" error={state.fields?.confirm} />
        <Submit pendingText="Creating account…">Create Account</Submit>
      </form>
      <GoogleButton next={next} />
      <Footer>
        Already have an account?{" "}
        <Link href={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`} className="auth-link">
          Sign In
        </Link>
      </Footer>
    </div>
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
