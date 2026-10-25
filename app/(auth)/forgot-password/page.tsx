import type { Metadata } from "next";
import { ForgotForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
