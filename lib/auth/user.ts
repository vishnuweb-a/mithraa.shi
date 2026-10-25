import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; email: string; name: string };

/**
 * The signed-in user, verified on the server (getClaims checks the JWT
 * signature; getSession alone would trust the cookie). Redirects to /login
 * when there is none. Call it close to any data a page or action reads:
 * the proxy is a convenience, not the authorization boundary.
 */
export async function requireUser(): Promise<CurrentUser> {
  // always at request time: token expiry checks read the clock, and a cached user could outlive a sign-out
  await connection();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/login");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");

  // profiles is RLS-scoped to the user and co-members; display_name is cosmetic, never authorization
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", claims.sub).maybeSingle();
  const email = claims.email ?? "";
  return { id: claims.sub, email, name: profile?.display_name?.trim() || email };
}

/**
 * True only for a session that came from a password-recovery link in the last
 * hour, so an ordinary signed-in session (or a borrowed laptop) cannot set a
 * new password without the old one.
 */
export async function hasRecoverySession() {
  await connection();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return false;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const now = Date.now() / 1000;
  return (data?.claims?.amr ?? []).some((m) => typeof m === "object" && m.method === "recovery" && now - m.timestamp < 3600);
}
