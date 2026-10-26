import type { HomeProgress } from "./home-run-types.ts";

export const TERMINAL_RUN_STATUSES = new Set(["completed", "partial", "failed", "cancelled"]);

/** Pure UI policy. The server remains authoritative about leases and retry eligibility. */
export function runControls(progress: HomeProgress | null, busy: boolean, now = Date.now()) {
  const terminal = Boolean(progress && TERMINAL_RUN_STATUSES.has(progress.run.status));
  const next = progress?.steps.find(s => !["completed", "skipped", "failed"].includes(s.status));
  const cancelled = Boolean(progress?.run.cancel_requested_at);
  const retryAt = next?.status === "queued" && next.error_code && next.next_attempt_at
    ? Date.parse(next.next_attempt_at) : NaN;
  const waiting = Number.isFinite(retryAt) && retryAt > now;
  return { next, waiting, retryAt: Number.isFinite(retryAt) ? retryAt : null,
    cancelled,
    canAdvance: Boolean(progress && !terminal && !busy && (!waiting || cancelled)) };
}

/** An idle claim can also mean successful cancellation or terminal cleanup. */
export function idleAdvanceMessage(state: string, after: HomeProgress): string | null {
  if (state !== "idle" || TERMINAL_RUN_STATUSES.has(after.run.status)) return null;
  const stillQueued = after.steps.some(step => step.status === "queued" || step.status === "running");
  return stillQueued ? "This step is not ready yet. Please try again shortly." : null;
}

/** A lost cancel response is success if the DB recorded the request or finalized it. */
export function cancelErrorMessage(original: string, after: HomeProgress): string | null {
  return TERMINAL_RUN_STATUSES.has(after.run.status) || after.run.cancel_requested_at
    ? null : original;
}
