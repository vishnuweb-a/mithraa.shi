import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/forms";
import { safeNext } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  return <SignupForm next={safeNext(typeof next === "string" ? next : null)} />;
}
