import type { HomeProgress } from "./home-run-types.ts";

/** Pure controls derived from persisted DB statuses. Never infer time from render clocks. */
export function runControls(progress: HomeProgress | null, busy: boolean) {
  const terminal = Boolean(progress && ["completed", "partial", "failed", "cancelled"].includes(progress.run.status));
  const next = progress?.steps.find(s => !["completed", "skipped", "failed"].includes(s.status));
  const waiting = next?.status === "queued" && Boolean(next.error_code);
  const cancelled = Boolean(progress?.run.cancel_requested_at);
  return { next, waiting, cancelled, terminal,
    canAdvance: Boolean(progress && !terminal && !busy && next) };
}
