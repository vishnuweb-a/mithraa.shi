import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_PAGES, safeNext } from "@/lib/auth/redirect";

/**
 * Refreshes the Supabase session cookie on every request and sends signed-out
 * visitors to /login. Deny by default: only the auth pages, /auth/* and
 * /reset-password (which checks its own recovery session) are public.
 * The workspace layout verifies the user again; this is not the only check.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  let signedIn = false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // no Supabase config means nobody can sign in, so every protected route stays closed
  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          // Cache-Control: private, no-store whenever auth cookies change, so a CDN never shares them
          Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    });
    // getClaims verifies the JWT and refreshes an expired session; do not run code between this and createServerClient
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  }

  const { pathname, search } = request.nextUrl;
  const isAuthPage = AUTH_PAGES.includes(pathname);
  const isPublic = isAuthPage || pathname === "/reset-password" || pathname.startsWith("/auth/");

  if (signedIn && isAuthPage) return redirectKeepingCookies(request, response, safeNext(request.nextUrl.searchParams.get("next")));
  if (!signedIn && !isPublic) {
    const to = pathname === "/" ? "/login" : `/login?next=${encodeURIComponent(pathname + search)}`;
    return redirectKeepingCookies(request, response, to);
  }
  if (!isPublic) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function redirectKeepingCookies(request: NextRequest, from: NextResponse, to: string) {
  const res = NextResponse.redirect(new URL(to, request.url));
  from.cookies.getAll().forEach((c) => res.cookies.set(c));
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const config = {
  // everything except build assets, the favicon and public media files
  matcher: ["/((?!_next/static|_next/image|favicon.ico|media/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
