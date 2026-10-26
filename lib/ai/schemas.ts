import {
  AgentValidationError, type AgentKey, type AgentOutputs, type MarketInsight,
} from "./contracts";

const s = { type: "string" };
const n = { type: "number" };
const b = { type: "boolean" };
const strings = { type: "array", items: s };
function shape(properties: Record<string, unknown>) {
  return {
    type: "object", properties, required: Object.keys(properties), additionalProperties: false,
  };
}
export const OUTPUT_SCHEMAS: Record<AgentKey, Record<string, unknown>> = {
  idea_capture: shape({
    title: s, logline: s, synopsis: s, genre: s, tone: strings,
    themes: strings, characters: strings, language: s,
  }),
  market_scout: shape({
    audience: s, comparableTitles: strings,
    insights: { type: "array", items: shape({
      claim: s, sourceUrl: { type: ["string", "null"] },
      evidenceStatus: { type: "string", enum: ["sourced", "unverified", "unavailable"] },
    }) },
    limitations: strings,
  }),
  premise_scorer: shape({
    overall: n, dimensions: { type: "array", items: shape({
      category: s, score: n, explanation: s,
    }) }, suggestions: strings,
  }),
  ip_scout: shape({
    status: { type: "string", enum: ["flagged", "needs_review", "no_reference_detected"] },
    concerns: strings, rightsToVerify: strings, legalClearanceGranted: b,
  }),
};

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentValidationError(name + " must be an object");
  }
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string, max = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new AgentValidationError(field + " must be nonempty text within size limits");
  }
  return value.trim();
}
function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > 30) {
    throw new AgentValidationError(field + " must be an array (up to 30 items)");
  }
  return value as unknown[];
}
function stringArray(value: unknown, field: string): string[] {
  return array(value, field).map((v, i) => string(v, field + "[" + i + "]", 500));
}
function score(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new AgentValidationError(field + " must be between 0 and 100");
  }
  return value;
}
function httpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password && value.length <= 2048;
  } catch { return false; }
}

/** Validate model output at runtime even if the provider claims strict JSON. */
export function validateOutput<K extends AgentKey>(
  key: K, raw: unknown, researchEvidence = "",
): AgentOutputs[K] {
  const obj = record(raw, key);

  if (key === "idea_capture") {
    return {
      title: string(obj.title, "title", 200),
      logline: string(obj.logline, "logline", 1000),
      synopsis: string(obj.synopsis, "synopsis", 3500),
      genre: string(obj.genre, "genre", 150),
      tone: stringArray(obj.tone, "tone"),
      themes: stringArray(obj.themes, "themes"),
      characters: stringArray(obj.characters, "characters"),
      language: string(obj.language, "language", 80),
    } as AgentOutputs[K];
  }

  if (key === "market_scout") {
    const insights: MarketInsight[] = array(obj.insights, "insights").map((value) => {
      const item = record(value, "market insight");
      const claim = string(item.claim, "claim", 750);
      const sourceUrl = item.sourceUrl === null ? null : string(item.sourceUrl, "sourceUrl", 2048);
      const evidenceStatus = item.evidenceStatus;
      if (evidenceStatus !== "sourced" && evidenceStatus !== "unverified" && evidenceStatus !== "unavailable") {
        throw new AgentValidationError("Unsupported evidence status");
      }
      if (sourceUrl !== null && !httpsUrl(sourceUrl)) throw new AgentValidationError("Invalid evidence URL");
      if (evidenceStatus === "sourced" && (!sourceUrl || !researchEvidence.includes(sourceUrl))) {
        throw new AgentValidationError("Sourced market claim lacks a URL present in retrieved evidence");
      }
      return { claim, sourceUrl, evidenceStatus };
    });
    return {
      audience: string(obj.audience, "audience", 1200),
      comparableTitles: stringArray(obj.comparableTitles, "comparableTitles"),
      insights,
      limitations: stringArray(obj.limitations, "limitations"),
    } as AgentOutputs[K];
  }

  if (key === "premise_scorer") {
    const dimensions = array(obj.dimensions, "dimensions").map((v) => {
      const dim = record(v, "score dimension");
      return { category: string(dim.category, "category", 100),
        score: score(dim.score, "score"), explanation: string(dim.explanation, "explanation", 700) };
    });
    if (dimensions.length < 3) throw new AgentValidationError("Scorecard needs three or more dimensions");
    return {
      overall: score(obj.overall, "overall"),
      dimensions, suggestions: stringArray(obj.suggestions, "suggestions"),
    } as AgentOutputs[K];
  }

  if (key === "ip_scout") {
    if (obj.status !== "flagged" && obj.status !== "needs_review" && obj.status !== "no_reference_detected") {
      throw new AgentValidationError("Invalid IP review state");
    }
    if (obj.legalClearanceGranted !== false) {
      throw new AgentValidationError("Agents must never grant legal clearance");
    }
    return {
      status: obj.status, concerns: stringArray(obj.concerns, "concerns"),
      rightsToVerify: stringArray(obj.rightsToVerify, "rightsToVerify"),
      legalClearanceGranted: false,
    } as AgentOutputs[K];
  }
  throw new AgentValidationError("Unsupported agent");
}
