import { AgentValidationError, type AgentKey, type QualityTier, type RoutingMode } from "./contracts";

/**
 * Provider-neutral SHI Router, first version. It only selects Groq models now;
 * future adapters can replace this mapping without changing agent prompts/UI.
 *
 * "compare" requires parallel paid/free quota accounting and is NOT simulated.
 */
const FAST = "openai/gpt-oss-20b";
const DEEP = "openai/gpt-oss-120b";
const ALLOWED = new Set([FAST, DEEP]);

export function selectGroqModel(input: {
  agent: AgentKey;
  mode: RoutingMode;
  qualityTier: QualityTier;
  pinnedModel?: string;
}): string {
  if (input.mode === "compare") {
    throw new AgentValidationError("Compare mode is not implemented; do not simulate multiple model outputs");
  }
  if (input.mode === "pinned") {
    if (!input.pinnedModel || !ALLOWED.has(input.pinnedModel)) {
      throw new AgentValidationError("Pinned model must be an approved Groq model");
    }
    return input.pinnedModel;
  }
  if (input.mode === "budget_first") return FAST;
  if (input.mode === "quality_first") return DEEP;
  if (input.mode !== "auto") throw new AgentValidationError("Unknown routing mode");

  const needDepth = input.agent === "premise_scorer" || input.agent === "ip_scout";
  const premium = input.qualityTier === "premium" || input.qualityTier === "master";
  return premium && needDepth ? DEEP : FAST;
}

export const GROQ_MODELS = { fast: FAST, deep: DEEP } as const;
