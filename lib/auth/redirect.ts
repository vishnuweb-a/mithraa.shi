/** Pages a signed-out visitor may open. Everything else in the app needs a session. */
export const AUTH_PAGES = ["/login", "/signup", "/forgot-password"];

/**
 * Turns an untrusted `next` value into a same-origin path, or "/" when it is
 * anything else (absolute URL, protocol-relative, backslash tricks, auth pages).
 * No imports, so `node --test` can run it directly.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  let url: URL;
  try {
    url = new URL(next, "http://same.origin");
  } catch {
    return "/";
  }
  // the URL parser strips tabs and newlines, so "/\t/evil.com" only shows up as foreign here
  if (url.origin !== "http://same.origin") return "/";
  if (AUTH_PAGES.includes(url.pathname) || url.pathname.startsWith("/auth/")) return "/";
  return url.pathname + url.search + url.hash;
}
