import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/redirect";

/**
 * Where Supabase sends people back after Google sign-in, an email confirmation
 * or a password-reset link (all PKCE). Exchanges the one-time code for a
 * session cookie, then goes to a same-origin path only.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"));
  const fail = (error: string) => {
    const to = new URL("/login", request.url);
    to.searchParams.set("error", error);
    if (next !== "/") to.searchParams.set("next", next);
    return NextResponse.redirect(to);
  };

  // provider said no (e.g. the user closed Google's consent screen); its text is never echoed back
  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "cancelled" : "provider");
  const code = params.get("code");
  if (!code) return fail("link");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  // missing verifier cookie (link opened in another browser), reused or expired code
  if (error || !data.session) return fail("link");
  return NextResponse.redirect(new URL(next, request.url));
}
