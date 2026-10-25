"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/redirect";
import { hasRecoverySession } from "@/lib/auth/user";
import { explain, resetReply } from "@/lib/auth/messages";

export type FormState = { error?: string; fields?: Record<string, string>; sent?: boolean; email?: string; name?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/** Where Supabase may send people back to. SITE_URL pins it per deployment; otherwise the Origin header Next already CSRF-checked. */
async function origin() {
  return process.env.SITE_URL ?? (await headers()).get("origin") ?? "http://localhost:3000";
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function passwordProblem(password: string) {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > 72) return "Use 72 characters or fewer.";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return "Mix letters and numbers.";
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email");
  const password = String(form.get("password") ?? "");
  if (!EMAIL.test(email)) return { email, fields: { email: "Enter a valid email address." } };
  if (!password) return { email, fields: { password: "Enter your password." } };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { email, error: explain(error.code) };
  redirect(safeNext(str(form, "next")));
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const name = str(form, "name");
  const email = str(form, "email");
  const password = String(form.get("password") ?? "");
  const fields: Record<string, string> = {};
  if (!name) fields.name = "Enter your full name.";
  else if (name.length > 120) fields.name = "Use 120 characters or fewer.";
  if (!EMAIL.test(email)) fields.email = "Enter a valid email address.";
  const weak = passwordProblem(password);
  if (weak) fields.password = weak;
  else if (password !== String(form.get("confirm") ?? "")) fields.confirm = "Passwords don't match.";
  if (Object.keys(fields).length) return { email, name, fields };

  const next = safeNext(str(form, "next"));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // display_name feeds profiles.display_name only (see handle_new_user); it never grants access
    options: { data: { display_name: name }, emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  // an existing address gets the same answer as a new one, so the form can't be used to probe accounts
  if (error && error.code !== "user_already_exists") return { email, name, error: explain(error.code) };
  if (data.session) redirect(next);
  return { sent: true, email };
}

export async function signInWithGoogle(form: FormData) {
  const next = safeNext(str(form, "next"));
  const supabase = await createClient();
  // the PKCE verifier lands in a cookie here; /auth/callback exchanges the code with it
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect(`/login?error=google&next=${encodeURIComponent(next)}`);
  redirect(data.url);
}

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email");
  if (!EMAIL.test(email)) return { email, fields: { email: "Enter a valid email address." } };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/callback?next=/reset-password` });
  return { email, ...resetReply(error) };
}

export async function updatePassword(_: FormState, form: FormData): Promise<FormState> {
  if (!(await hasRecoverySession())) return { error: "This reset link has expired. Request a new one." };
  const password = String(form.get("password") ?? "");
  const weak = passwordProblem(password);
  if (weak) return { fields: { password: weak } };
  if (password !== String(form.get("confirm") ?? "")) return { fields: { confirm: "Passwords don't match." } };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: explain(error.code) };
  // other devices keep their old sessions otherwise
  await supabase.auth.signOut({ scope: "others" });
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
