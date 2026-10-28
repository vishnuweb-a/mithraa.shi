import type { AgentKey } from "@/lib/ai/contracts";
import type { HomeProgress, HomeStep } from "./home-run-types.ts";

export const TERMINAL_RUN_STATUSES = new Set(["completed", "partial", "failed", "cancelled"]);
export const MAX_ATTEMPTS = 3;

export const LIVE_AGENTS: ReadonlyArray<{ key: AgentKey; name: string }> = [
  { key: "idea_capture", name: "Idea Capture" },
  { key: "market_scout", name: "Market Scout" },
  { key: "premise_scorer", name: "Premise Scorer" },
  { key: "ip_scout", name: "IP Scout" },
];
const agentName = (key: AgentKey) => LIVE_AGENTS.find(a => a.key === key)?.name ?? "An agent";

/** Plain-language causes; technical diagnostics stay in server logs. */
const REASONS: Record<string, string> = {
  rate_limited: "was paused because the AI service is rate-limited",
  agent_validation: "returned an invalid response",
  json_validate_failed: "returned an invalid response",
  agent_malformed_json: "returned an unreadable response",
  output_truncated: "returned an incomplete response",
  research_empty: "found no research evidence",
  provider_unavailable: "could not reach the AI service",
  provider_transport: "lost its connection to the AI service",
  provider_auth: "could not run because the AI service rejected the server credentials",
  provider_config: "could not run because the AI service is misconfigured",
  context_length_exceeded: "received more input than the model accepts",
  attempts_exhausted: "stopped responding before it finished",
  prerequisite_missing: "could not start because an earlier result is missing",
  prerequisite_invalid: "could not start because an earlier result is invalid",
  run_input_unavailable: "could not load the saved idea",
};

/** Pure UI policy. The server remains authoritative about leases and retry eligibility. */
export function runControls(progress: HomeProgress | null, busy: boolean, now = Date.now()) {
  const terminal = Boolean(progress && TERMINAL_RUN_STATUSES.has(progress.run.status));
  const next = progress?.steps.find(s => !["completed", "skipped", "failed"].includes(s.status));
  const cancelled = Boolean(progress?.run.cancel_requested_at);
  // A failed agent stops the run; Continue only lets the server finalize it.
  const stopped = !terminal && Boolean(progress?.steps.some(s => s.status === "failed"));
  const retryAt = next?.status === "queued" && next.error_code && next.next_attempt_at
    ? Date.parse(next.next_attempt_at) : NaN;
  const waiting = Number.isFinite(retryAt) && retryAt > now;
  return { next, waiting, retryAt: Number.isFinite(retryAt) ? retryAt : null,
    cancelled, stopped,
    canAdvance: Boolean(progress && !terminal && !busy && (!waiting || cancelled)) };
}

/** One understandable line per step that needs explaining, or null. */
export function stepMessage(step: HomeStep): string | null {
  const name = agentName(step.agent_key);
  if (step.status === "skipped") {
    return step.error_code === "prerequisite_failed" ? `${name} did not run because an earlier agent failed.` : null;
  }
  if (!step.error_code || (step.status !== "failed" && step.status !== "queued")) return null;
  const reason = REASONS[step.error_code] ?? "hit an unexpected error";
  const plural = step.attempts === 1 ? "" : "s";
  return step.status === "failed"
    ? `${name} ${reason} and could not complete after ${step.attempts} attempt${plural}.`
    : `${name} ${reason}. Retry ${step.attempts + 1} of ${MAX_ATTEMPTS} is scheduled.`;
}

/** Run-level outcome, so a stopped run never reads like a successful one. */
export function runNotice(progress: HomeProgress | null): string | null {
  if (!progress) return null;
  const failed = progress.steps.find(s => s.status === "failed");
  if (!failed) return null;
  const name = agentName(failed.agent_key);
  return TERMINAL_RUN_STATUSES.has(progress.run.status)
    ? `Run stopped at ${name}. Completed results are kept; start a new run to try again.`
    : `${name} failed, so later agents will not run. Continue to finalize this run.`;
}

/** Countdown label: whole minutes until the final minute, then seconds. Never negative. */
export function retryRemaining(ms: number): string {
  const remaining = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return remaining >= 60_000 ? `${Math.ceil(remaining / 60_000)} min` : `${Math.ceil(remaining / 1_000)} sec`;
}

/** An idle claim can also mean successful cancellation or terminal cleanup. */
export function idleAdvanceMessage(state: string, after: HomeProgress): string | null {
  if (state !== "idle" || TERMINAL_RUN_STATUSES.has(after.run.status)) return null;
  const next = after.steps.find(step => step.status === "queued" || step.status === "running");
  const blocked = next?.status === "running" || runControls(after, false).waiting;
  return blocked ? "This step is not ready yet. Please try again shortly." : null;
}

/** A lost cancel response is success if the DB recorded the request or finalized it. */
export function cancelErrorMessage(original: string, after: HomeProgress): string | null {
  return TERMINAL_RUN_STATUSES.has(after.run.status) || after.run.cancel_requested_at
    ? null : original;
}
