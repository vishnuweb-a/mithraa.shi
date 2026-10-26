import type { HomeProgress } from "./home-run-types.ts";

/** Pure UI policy. The server remains authoritative about leases and retry eligibility. */
export function runControls(progress: HomeProgress | null, busy: boolean, now = Date.now()) {
  const terminal = Boolean(progress && ["completed", "partial", "failed", "cancelled"].includes(progress.run.status));
  const next = progress?.steps.find(s => !["completed", "skipped", "failed"].includes(s.status));
  const cancelled = Boolean(progress?.run.cancel_requested_at);
  const retryAt = next?.status === "queued" && next.error_code && next.next_attempt_at
    ? Date.parse(next.next_attempt_at) : NaN;
  const waiting = Number.isFinite(retryAt) && retryAt > now;
  return { next, waiting, retryAt: Number.isFinite(retryAt) ? retryAt : null,
    cancelled, terminal,
    canAdvance: Boolean(progress && !terminal && !busy && next && (!waiting || cancelled)) };
}
