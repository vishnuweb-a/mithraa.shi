import {
  AgentValidationError, AGENT_KEYS, type AgentExecution, type AgentKey, type IdeaInput,
  type RoutingMode,
} from "./contracts.ts";
import { validateOutput } from "./schemas.ts";
import { runHomeAgent } from "./agents.ts";
import { ProviderRequestError } from "./providers/groq.ts";
import { createWorkerClient, translateDbError } from "./home-server.ts";
import { HomeRequestError, requireUuid } from "./home-http.ts";

type Row = Record<string, unknown>;
type Lease = { step_id: string; claimed_run_id: string; agent_key: AgentKey; lease_token: string; attempt_number: number };
type Failure = { code: string; retryable: boolean; retryAfterSeconds: number | null };

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

export function classifyAgentFailure(error: unknown): Failure {
  if (error instanceof ProviderRequestError) {
    if (error.status === 429) return {
      code: "rate_limited", retryable: true, retryAfterSeconds: error.retryAfterSeconds,
    };
    if (error.providerCode === "json_validate_failed") return {
      code: "json_validate_failed", retryable: true, retryAfterSeconds: null,
    };
    if (error.status !== null && (error.status >= 500 || error.status === 408 || error.status === 425)) {
      return { code: "provider_unavailable", retryable: true, retryAfterSeconds: error.retryAfterSeconds };
    }
    if (error.message === "Groq request timed out" || error.message === "Groq network request failed" ||
      error.message === "Groq request cancelled") {
      return { code: "provider_transport", retryable: true, retryAfterSeconds: null };
    }
    if (error.status === 401 || error.status === 403) return {
      code: "provider_auth", retryable: false, retryAfterSeconds: null,
    };
    return { code: "provider_rejected", retryable: false, retryAfterSeconds: null };
  }
  if (error instanceof AgentValidationError) {
    // Malformed model JSON may be transient. Input validation errors are
    // precluded by the stored-input check before the provider is called.
    return { code: "agent_validation", retryable: true, retryAfterSeconds: null };
  }
  if (error instanceof HomeRequestError) {
    return { code: error.code, retryable: false, retryAfterSeconds: null };
  }
  return { code: "agent_unexpected_error", retryable: false, retryAfterSeconds: null };
}

export function marketSourceCandidates(execution: AgentExecution): Array<{
  url: string; title: string; claim: string;
}> {
  if (execution.key !== "market_scout") return [];
  const result = validateOutput("market_scout", execution.output, execution.evidence ?? "");
  const seen = new Set<string>();
  return result.insights.flatMap((insight) => {
    const url = insight.sourceUrl;
    if (insight.evidenceStatus !== "sourced" || !url || seen.has(url)) return [];
    seen.add(url);
    return [{ url, title: "Referenced research source", claim: insight.claim.slice(0, 500) }];
  }).slice(0, 20);
}

function storedMode(run: Row): { mode: RoutingMode; pinnedModel?: string } {
  const mode = requiredText(run.model_mode);
  if (!["auto", "budget_first", "quality_first", "pinned"].includes(mode)) {
    throw new HomeRequestError(400, "unsupported_run_mode");
  }
  const opts = run.request_options;
  const options = opts && typeof opts === "object" && !Array.isArray(opts) ? opts as Row : {};
  const pinnedModel = options.pinnedModel;
  if (mode === "pinned" && typeof pinnedModel !== "string") {
    throw new HomeRequestError(400, "unsupported_run_mode");
  }
  return { mode: mode as RoutingMode, ...(typeof pinnedModel === "string" ? { pinnedModel } : {}) };
}

/**
 * One invocation claims at most ONE step. The caller's identity is verified
 * by its API route before passing ownerId. All writes are gated by a service
 * JWT and validated via database RPCs. There are no background timers.
 */
export async function executeRunStep(runId: string, ownerId: string): Promise<{
  state: "executed" | "retry_scheduled" | "idle" | "lease_lost";
  agent?: AgentKey; outcome?: "completed" | "failed"; errorCode?: string;
}> {
  requireUuid(runId);
  requireUuid(ownerId);
  const db = createWorkerClient();
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
  if (claimError) throw translateDbError(claimError);
  if (!Array.isArray(claims) || claims.length === 0) return { state: "idle" };
  const lease = validateLease(claims[0]);
  if (lease.claimed_run_id !== runId) throw new HomeRequestError(500, "worker_claim_mismatch");

  let result: AgentExecution | null = null;
  let failure: Failure | null = null;
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
    const routing = storedMode(run);
    // Completed, validated Idea Capture output enriches subsequent agents.
    const { data: capture, error: captureError } = await db.from("agent_steps")
      .select("output,status").eq("run_id", runId).eq("agent_key", "idea_capture").maybeSingle();
    if (captureError) throw new HomeRequestError(500, "run_input_unavailable");
    const preceding = capture?.status === "completed" && capture.output
      ? { idea_capture: validateOutput("idea_capture", capture.output) } : undefined;
    result = await runHomeAgent(lease.agent_key, input, { ...routing, preceding });
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
