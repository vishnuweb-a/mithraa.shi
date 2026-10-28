/**
 * Internal, model-neutral AI contracts. These types are for trusted server code;
 * never call a model provider directly from a browser component.
 */
export const AGENT_KEYS = ["idea_capture", "market_scout", "premise_scorer", "ip_scout"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];
export type RoutingMode = "auto" | "budget_first" | "quality_first" | "pinned" | "compare";
export type QualityTier = "draft" | "standard" | "premium" | "master";

export interface IdeaInput {
  originalText: string;
  languageCode: string;
  templateKey: string;
  productionMode: "shot" | "hybrid" | "generated";
  qualityTier: QualityTier;
}

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  source: "provider" | "unavailable";
}

export interface ModelResult<T> {
  data: T;
  usage: TokenUsage;
  model: string;
  /** Diagnostics only; never content. */
  requestId?: string | null;
  finishReason?: string | null;
}

/** Content-free metadata for one provider request, successful or not. */
export interface ProviderCall {
  kind: "research" | "generate";
  provider: string;
  model: string;
  requestId: string | null;
  finishReason: string | null;
  usage: TokenUsage;
  durationMs: number;
}

export interface ModelProvider {
  readonly name: string;
  generateStructured(input: {
    model: string;
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
    maxOutputTokens?: number;
    signal?: AbortSignal;
  }): Promise<ModelResult<unknown>>;
  research(input: {
    model: string;
    query: string;
    signal?: AbortSignal;
  }): Promise<ModelResult<string>>;
}

export interface IdeaCaptureOutput {
  title: string;
  logline: string;
  synopsis: string;
  genre: string;
  tone: string[];
  themes: string[];
  characters: string[];
  language: string;
}

export type EvidenceStatus = "sourced" | "unverified" | "unavailable";

export interface MarketInsight {
  claim: string;
  sourceUrl: string | null;
  evidenceStatus: EvidenceStatus;
}
export interface MarketScoutOutput {
  audience: string;
  comparableTitles: string[];
  insights: MarketInsight[];
  limitations: string[];
}

export interface ScoreDimension {
  category: string;
  score: number;
  explanation: string;
}
export interface PremiseScoreOutput {
  overall: number;
  dimensions: ScoreDimension[];
  suggestions: string[];
}
export interface IPScoutOutput {
  status: "flagged" | "needs_review" | "no_reference_detected";
  concerns: string[];
  rightsToVerify: string[];
  legalClearanceGranted: false;
}

export type AgentOutputs = {
  idea_capture: IdeaCaptureOutput;
  market_scout: MarketScoutOutput;
  premise_scorer: PremiseScoreOutput;
  ip_scout: IPScoutOutput;
};

export interface AgentExecution<K extends AgentKey = AgentKey> {
  key: K;
  output: AgentOutputs[K];
  provider: string;
  model: string;
  promptVersion: string;
  usage: TokenUsage;
  /** Search evidence is untrusted; do not display its claims as verified data. */
  evidence?: string;
}

export class AgentValidationError extends Error {
  /** Field path and issue code come from our validator, never from model text. */
  readonly path: string;
  readonly issue: string;
  constructor(message: string, path = "", issue = "invalid") {
    super(message);
    this.name = "AgentValidationError";
    this.path = path;
    this.issue = issue;
  }
}

export function checkIdeaInput(input: IdeaInput): void {
  if (input.originalText.trim().length < 1 || input.originalText.length > 12000) {
    throw new AgentValidationError("Idea text must be between 1 and 12000 characters");
  }
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(input.languageCode)) {
    throw new AgentValidationError("Invalid language code");
  }
  const templates = new Set([
    "theatrical_feature", "vfx_feature", "ott_series", "documentary",
    "micro_drama", "brand_ad", "animation", "social_reels", "creator_video", "side_gig"
  ]);
  if (!templates.has(input.templateKey)) {
    throw new AgentValidationError("Unsupported idea template");
  }
  if (!["shot", "hybrid", "generated"].includes(input.productionMode)) {
    throw new AgentValidationError("Unsupported production mode");
  }
  if (!["draft", "standard", "premium", "master"].includes(input.qualityTier)) {
    throw new AgentValidationError("Unsupported quality tier");
  }
}

export function combineUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens === null || b.inputTokens === null ? null : a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens === null || b.outputTokens === null ? null : a.outputTokens + b.outputTokens,
    source: a.source === "provider" && b.source === "provider" ? "provider" : "unavailable",
  };
}
