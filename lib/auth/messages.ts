import { isAuthRetryableFetchError, type AuthError } from "@supabase/supabase-js";

// Supabase error codes we explain; anything else gets a generic line so internals never reach the page.
const MESSAGES: Record<string, string> = {
  invalid_credentials: "That email and password don't match. Check them and try again.",
  email_not_confirmed: "Confirm your email first. Open the link we sent when you signed up.",
  weak_password: "That password is too easy to guess. Try a longer one.",
  over_email_send_rate_limit: "Too many emails sent. Wait a minute and try again.",
  over_request_rate_limit: "Too many attempts. Wait a minute and try again.",
  same_password: "Choose a password you haven't used here before.",
};
export const explain = (code?: string) => (code && MESSAGES[code]) || "Something went wrong on our side. Try again in a moment.";

/**
 * The forgot-password form's answer to a resetPasswordForEmail result. Never
 * says "sent" unless Supabase accepted the request. Unknown addresses already
 * get a success from Supabase, so they look like real ones.
 */
export function resetReply(error: AuthError | null): { sent: true } | { error: string } | { fields: { email: string } } {
  if (!error) return { sent: true };
  // GoTrue's per-address cooldown fires only for real accounts, so a distinct reply would reveal who has one; a link went out moments ago anyway.
  // shortcut: matched on GoTrue's wording; if that changes this falls back to the retry message (reveals the account, never fakes a send).
  if (error.code === "over_email_send_rate_limit" && /only request this after/i.test(error.message)) return { sent: true };
  if (error.code === "validation_failed" || error.code === "email_address_invalid") return { fields: { email: "Enter a valid email address." } };
  if (error.code?.startsWith("over_")) return { error: explain(error.code) };
  // status 0: the fetch itself failed, so Supabase was never reached
  if (isAuthRetryableFetchError(error) && error.status === 0) return { error: "We couldn't reach the sign-in service. Try again in a moment." };
  // SMTP or provider failure (GoTrue: 500 "Error sending recovery email")
  return { error: "We couldn't send the reset email just now. Try again in a few minutes." };
}
