import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "@/components/auth/forms";
import { hasRecoverySession } from "@/lib/auth/user";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // visiting the URL is not enough: only a fresh recovery session from the emailed link may set a password
  if (!(await hasRecoverySession())) {
    return (
      <div className="flex flex-col gap-6" data-testid="reset-invalid">
        <h1 className="auth-title">This reset link isn&apos;t valid</h1>
        <p className="text-[16px] text-[var(--ink-2)]">It may have expired, been used already, or been opened in a different browser. Request a new one and open it on this device.</p>
        <Link href="/forgot-password" className="auth-primary">
          Request a new link
        </Link>
      </div>
    );
  }
  return <ResetForm />;
}
