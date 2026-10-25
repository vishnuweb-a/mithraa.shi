import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/forms";
import { safeNext } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Sign in" };

// Fixed copy per code: query text is never shown, so a crafted link can't put words on this page.
const NOTICES: Record<string, string> = {
  link: "That link has expired, was already used, or was opened in a different browser. Sign in, or request a new link.",
  cancelled: "Google sign-in was cancelled. Try again whenever you're ready.",
  provider: "Google couldn't sign you in. Try again, or use your email and password.",
  google: "We couldn't start Google sign-in. Try again in a moment.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  return <LoginForm next={safeNext(typeof next === "string" ? next : null)} notice={typeof error === "string" ? NOTICES[error] : undefined} />;
}
