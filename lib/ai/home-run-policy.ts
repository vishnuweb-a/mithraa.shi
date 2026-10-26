/**
 * Pure execution policy, shared by the trusted runner and Node unit tests.
 * No credentials, Next.js dependency, Supabase client, or server-only import.
 */
import { AgentValidationError, type AgentExecution, type RoutingMode } from "./contracts.ts";
import { validateOutput } from "./schemas.ts";
import { ProviderRequestError } from "./providers/groq.ts";
import { HomeRequestError } from "./home-http.ts";
import { selectGroqModel } from "./router.ts";

export type AgentFailure = {
  code: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
};

export function classifyAgentFailure(error: unknown): AgentFailure {
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
