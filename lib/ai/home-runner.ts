import "server-only";
import { AGENT_KEYS, checkIdeaInput, AgentValidationError, type AgentExecution, type AgentKey, type IdeaInput } from "./contracts.ts";
import { validateOutput } from "./schemas.ts";
import { runHomeAgent } from "./agents.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { translateDbError } from "./home-db-errors.ts";
import { HomeRequestError, requireUuid } from "./home-http.ts";
import { classifyAgentFailure, marketSourceCandidates, storedRunRouting, type AgentFailure } from "./home-run-policy.ts";

type Row = Record<string, unknown>;
type Lease = { step_id: string; claimed_run_id: string; agent_key: AgentKey; lease_token: string; attempt_number: number };

function row(data: unknown): Row {
  if (!data || Array.isArray(data) || typeof data !== "object") {
    throw new HomeRequestError(500, "worker_state_invalid");
  }
  return data as Row;
}
function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HomeRequestError(500, "worker_state_invalid");
  }
  return value;
}
function validateLease(value: unknown): Lease {
  const r = row(value);
  const agentKey = r.agent_key;
  if (!AGENT_KEYS.includes(agentKey as AgentKey)) throw new HomeRequestError(500, "invalid_agent_step");
  return {
    step_id: requireUuid(requiredText(r.step_id)),
    claimed_run_id: requireUuid(requiredText(r.claimed_run_id)),
    agent_key: agentKey as AgentKey,
    lease_token: requireUuid(requiredText(r.lease_token)),
    attempt_number: typeof r.attempt_number === "number" ? r.attempt_number : 0,
  };
}

/**
 * One invocation claims at most ONE step. The caller's identity is verified
 * by its API route before passing ownerId. All writes are gated by a service
 * JWT and validated via database RPCs. There are no background timers.
 */
export async function executeRunStep(
  runId: string, ownerId: string,
  deps: { db?: SupabaseClient; runAgent?: typeof runHomeAgent } = {},
): Promise<{
  state: "executed" | "retry_scheduled" | "idle" | "lease_lost";
  agent?: AgentKey; outcome?: "completed" | "failed"; errorCode?: string;
}> {
  requireUuid(runId);
  requireUuid(ownerId);
  // Production obtains a server-only client; tests inject an in-memory fake,
  // allowing the full claim/preflight/Groq/finalize order to be exercised.
  const db = deps.db ?? (await import("./home-server.ts")).createWorkerClient();
  const { data: rawRun, error: runError } = await db
    .from("agent_runs")
    .select("id,owner_id,idea_id,idea_version,model_mode,request_options,status")
    .eq("id", runId).eq("owner_id", ownerId).maybeSingle();
  if (runError) throw translateDbError(runError);
  if (!rawRun) throw new HomeRequestError(404, "run_not_found");
  const run = row(rawRun);
  if (run.status !== "queued" && run.status !== "running") {
    return { state: "idle" };
  }

  const { data: claims, error: claimError } = await db.rpc("claim_home_agent_step", { p_run_id: runId });
  if (claimError?.code === "42501") throw new HomeRequestError(503, "worker_not_configured");
  if (claimError) throw translateDbError(claimError);
  if (!Array.isArray(claims) || claims.length === 0) return { state: "idle" };
  const lease = validateLease(claims[0]);
  if (lease.claimed_run_id !== runId) throw new HomeRequestError(500, "worker_claim_mismatch");

  let result: AgentExecution | null = null;
  let failure: AgentFailure | null = null;
  try {
    const [{ data: draft, error: draftError }, { data: version, error: versionError }] = await Promise.all([
      db.from("idea_drafts")
        .select("language_code,template_key,production_mode,quality_tier")
        .eq("id", requiredText(run.idea_id)).eq("owner_id", ownerId).single(),
      db.from("idea_versions")
        .select("original_text")
        .eq("idea_id", requiredText(run.idea_id)).eq("version_number", run.idea_version).single(),
    ]);
    if (draftError || versionError) throw new HomeRequestError(500, "run_input_unavailable");
    const d = row(draft);
    const v = row(version);
    const input: IdeaInput = {
      originalText: requiredText(v.original_text),
      languageCode: requiredText(d.language_code),
      templateKey: requiredText(d.template_key),
      productionMode: requiredText(d.production_mode) as IdeaInput["productionMode"],
      qualityTier: requiredText(d.quality_tier) as IdeaInput["qualityTier"],
    };
    // Do not retry invalid owner-written queue RPC options or corrupt inputs.
    // These errors are deterministic and cannot be fixed by another Groq call.
    try { checkIdeaInput(input); }
    catch (error) {
      if (error instanceof AgentValidationError) throw new HomeRequestError(400, "invalid_run_input");
      throw error;
    }
    const routing = storedRunRouting(run);
    // Completed, validated Idea Capture output enriches subsequent agents.
    const { data: capture, error: captureError } = await db.from("agent_steps")
      .select("output,status").eq("run_id", runId).eq("agent_key", "idea_capture").maybeSingle();
    if (captureError) throw new HomeRequestError(500, "run_input_unavailable");
    const preceding = capture?.status === "completed" && capture.output
      ? { idea_capture: validateOutput("idea_capture", capture.output) } : undefined;
    result = await (deps.runAgent ?? runHomeAgent)(lease.agent_key, input, { ...routing, preceding });
  } catch (error) {
    failure = classifyAgentFailure(error);
  }

  if (result) {
    const { data: committed, error: finishError } = await db.rpc("finish_home_agent_step", {
      p_step_id: lease.step_id,
      p_lease_token: lease.lease_token,
      p_outcome: "completed",
      p_output: result.output,
      p_provider: result.provider,
      p_model: result.model,
      p_prompt_version: result.promptVersion,
      p_input_tokens: result.usage.inputTokens,
      p_output_tokens: result.usage.outputTokens,
      p_usage_source: result.usage.source,
      p_sources: marketSourceCandidates(result),
    });
    if (finishError) throw translateDbError(finishError);
    return { state: committed ? "executed" : "lease_lost", agent: lease.agent_key, outcome: "completed" };
  }
  const error = failure ?? { code: "agent_unexpected_error", retryable: false, retryAfterSeconds: null };
  const { data: committed, error: finishError } = await db.rpc("finish_home_agent_step", {
    p_step_id: lease.step_id,
    p_lease_token: lease.lease_token,
    p_outcome: "failed",
    p_error_code: error.code,
    p_retryable: error.retryable,
    p_retry_after_seconds: error.retryAfterSeconds,
  });
  if (finishError) throw translateDbError(finishError);
  return {
    state: !committed ? "lease_lost" : error.retryable ? "retry_scheduled" : "executed",
    agent: lease.agent_key,
    outcome: "failed",
    errorCode: error.code,
  };
}
