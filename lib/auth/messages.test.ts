import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { resetReply } from "./messages.ts";

// Error shapes recorded from local GoTrue (supabase CLI 2.115.0); see docs/SUPABASE_AUTHENTICATION_IMPLEMENTATION.md.
const SENT = { sent: true };

test("accepted request, known or unknown address: generic success", () => {
  assert.deepEqual(resetReply(null), SENT);
});

test("per-address cooldown only exists for real accounts, so it looks like success", () => {
  const cooldown = new AuthApiError("For security purposes, you can only request this after 42 seconds.", 429, "over_email_send_rate_limit");
  assert.deepEqual(resetReply(cooldown), SENT);
});

test("project-wide email and request limits ask the user to wait", () => {
  assert.match((resetReply(new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit")) as { error: string }).error, /Wait a minute/);
  assert.match((resetReply(new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit")) as { error: string }).error, /Wait a minute/);
});

test("SMTP or provider failure is never reported as sent", () => {
  const smtp = new AuthRetryableFetchError("Error sending recovery email", 500);
  assert.deepEqual(resetReply(smtp), { error: "We couldn't send the reset email just now. Try again in a few minutes." });
  assert.deepEqual(resetReply(new AuthApiError("boom", 500, "unexpected_failure")), { error: "We couldn't send the reset email just now. Try again in a few minutes." });
});

test("Supabase unreachable gets a temporary-service message", () => {
  assert.deepEqual(resetReply(new AuthRetryableFetchError("fetch failed", 0)), { error: "We couldn't reach the sign-in service. Try again in a moment." });
});

test("address Supabase rejects is a field error", () => {
  assert.deepEqual(resetReply(new AuthApiError("Unable to validate email address: invalid format", 400, "validation_failed")), { fields: { email: "Enter a valid email address." } });
});

test("provider text never reaches the page", () => {
  for (const e of [new AuthApiError("<b>internal</b> db host 10.0.0.3", 500, "unexpected_failure"), new AuthRetryableFetchError("ECONNREFUSED 10.0.0.3", 0)]) {
    assert.doesNotMatch(JSON.stringify(resetReply(e)), /internal|10\.0\.0\.3|ECONNREFUSED/);
  }
});
