/**
 * Pure execution policy, shared by the trusted runner and Node unit tests.
 * No credentials, Next.js dependency, Supabase client, or server-only import.
 */
import {
  AGENT_KEYS, AgentValidationError, combineUsage, type AgentExecution, type AgentKey, type AgentOutputs,
  type ProviderCall, type RoutingMode, type TokenUsage,
} from "./contracts.ts";
import { validateOutput } from "./schemas.ts";
import { ProviderRequestError } from "./providers/groq.ts";
import { HomeRequestError } from "./home-http.ts";
import { selectGroqModel } from "./router.ts";

export type AgentFailure = {
  code: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
};

/** Malformed or incomplete model output: a bounded corrective retry may succeed. */
const OUTPUT_FAILURES: Record<string, string> = {
  json_validate_failed: "json_validate_failed",
  output_not_json: "agent_malformed_json",
  output_empty: "agent_malformed_json",
  output_truncated: "output_truncated",
  research_empty: "research_empty",
};
/** Configuration problems: retrying cannot help and only spends quota. */
const CONFIG_CODES = new Set(["missing_api_key", "model_not_found", "model_decommissioned", "model_permission_blocked"]);

export function classifyAgentFailure(error: unknown): AgentFailure {
  if (error instanceof ProviderRequestError) {
    if (error.status === 429) return {
      code: "rate_limited", retryable: true, retryAfterSeconds: error.retryAfterSeconds,
    };
    const output = error.providerCode ? OUTPUT_FAILURES[error.providerCode] : undefined;
    if (output) return { code: output, retryable: true, retryAfterSeconds: null };
    if (CONFIG_CODES.has(error.providerCode ?? "") || error.status === 404) {
      return { code: "provider_config", retryable: false, retryAfterSeconds: null };
    }
    if (error.providerCode === "context_length_exceeded" || error.status === 413) {
      return { code: "context_length_exceeded", retryable: false, retryAfterSeconds: null };
    }
    if (error.status !== null && (error.status >= 500 || error.status === 408 || error.status === 425)) {
      return { code: "provider_unavailable", retryable: true, retryAfterSeconds: error.retryAfterSeconds };
    }
    if (error.message === "Groq request timed out" ||
      error.message === "Groq network request failed" ||
      error.message === "Groq request cancelled") {
      return { code: "provider_transport", retryable: true, retryAfterSeconds: null };
    }
    if (error.status === 401 || error.status === 403) {
      return { code: "provider_auth", retryable: false, retryAfterSeconds: null };
    }
    return { code: "provider_rejected", retryable: false, retryAfterSeconds: null };
  }
  if (error instanceof AgentValidationError) {
    // This is model OUTPUT validation only; stored input and routing parameters
    // are rejected below with HomeRequestError before calling Groq.
    return { code: "agent_validation", retryable: true, retryAfterSeconds: null };
  }
  if (error instanceof HomeRequestError) {
    // 5xx during preflight reads are recoverable. Deterministic 4xx
    // (including invalid persisted model pins) must not retry.
    return { code: error.code, retryable: error.status >= 500,
      retryAfterSeconds: null };
  }
  return { code: "agent_unexpected_error", retryable: false, retryAfterSeconds: null };
}

/**
 * Safe, validator-generated detail kept on the step for the next corrective
 * attempt and logs, e.g. "too_long@dimensions[1].explanation". Never model text.
 */
export function failureDetail(error: unknown): string | null {
  if (error instanceof AgentValidationError && error.path) return error.issue + "@" + error.path;
  if (error instanceof ProviderRequestError && error.providerCode && OUTPUT_FAILURES[error.providerCode]) {
    return error.providerCode;
  }
  return null;
}

/**
 * Strict order, enforced again outside the database: every earlier agent must
 * have a completed, valid, persisted output before this agent may call Groq.
 */
export function precedingOutputs(agent: AgentKey, steps: Array<Record<string, unknown>>): Partial<AgentOutputs> {
  const preceding: Partial<Record<AgentKey, unknown>> = {};
  for (const key of AGENT_KEYS.slice(0, AGENT_KEYS.indexOf(agent))) {
    const step = steps.find((s) => s.agent_key === key);
    if (step?.status !== "completed" || !step.output) throw new HomeRequestError(409, "prerequisite_missing");
    try {
      // No research evidence here: any stored source URL is dropped from the context copy.
      preceding[key] = validateOutput(key, step.output);
    } catch (error) {
      if (error instanceof AgentValidationError) throw new HomeRequestError(409, "prerequisite_invalid");
      throw error;
    }
  }
  return preceding as Partial<AgentOutputs>;
}

/** Tokens spent across every call in one attempt, including failed ones. */
export function attemptUsage(calls: ProviderCall[]): TokenUsage {
  return combineUsage(...calls.map((c) => c.usage));
}

/** One structured, content-free log record per attempt. No prompts, outputs or credentials. */
export function attemptDiagnostics(input: {
  runId: string; agentKey: AgentKey; attempt: number; durationMs: number;
  calls: ProviderCall[]; failure: AgentFailure | null; error: unknown;
}): Record<string, unknown> {
  const usage = attemptUsage(input.calls);
  const validation = input.error instanceof AgentValidationError ? input.error : null;
  return {
    event: "home_agent_attempt",
    run_id: input.runId,
    agent_key: input.agentKey,
    attempt_number: input.attempt,
    outcome: input.failure ? "failed" : "completed",
    error_category: input.failure?.code ?? null,
    retryable: input.failure?.retryable ?? null,
    validation_failure_path: validation?.path || null,
    validation_failure_code: validation ? validation.issue : null,
    model: input.calls.at(-1)?.model ?? null,
    provider_request_ids: input.calls.map((c) => c.requestId),
    response_finish_reasons: input.calls.map((c) => c.finishReason),
    input_tokens: usage.inputTokens,
    output_token_usage: usage.outputTokens,
    duration_ms: input.durationMs,
  };
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

/** Validate persisted RPC options too: clients can call queue_idea_agent_run directly. */
export function storedRunRouting(run: Record<string, unknown>): { mode: RoutingMode; pinnedModel?: string } {
  const mode = run.model_mode;
  if (typeof mode !== "string" ||
    !["auto", "budget_first", "quality_first", "pinned"].includes(mode)) {
    throw new HomeRequestError(400, "unsupported_run_mode");
  }
  const raw = run.request_options;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HomeRequestError(400, "unsupported_run_options");
  }
  const opts = raw as Record<string, unknown>;
  const pinnedModel = opts.pinnedModel;
  if (pinnedModel !== undefined && (mode !== "pinned" || typeof pinnedModel !== "string")) {
    throw new HomeRequestError(400, "unsupported_run_options");
  }
  try {
    selectGroqModel({
      agent: "idea_capture",
      mode: mode as RoutingMode,
      qualityTier: "standard",
      pinnedModel: pinnedModel as string | undefined,
    });
  } catch (error) {
    if (error instanceof AgentValidationError) {
      throw new HomeRequestError(400, "unsupported_run_model");
    }
    throw error;
  }
  return { mode: mode as RoutingMode, ...(typeof pinnedModel === "string" ? { pinnedModel } : {}) };
}
