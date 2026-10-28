import {
  AgentValidationError, type AgentKey, type AgentOutputs, type MarketInsight,
} from "./contracts.ts";

/** Single source for limits: the validator enforces them and the schema tells the model. */
const MAX = {
  title: 200, logline: 1000, synopsis: 3500, genre: 150, language: 80, item: 500,
  audience: 1200, claim: 750, url: 2048, category: 100, explanation: 700, items: 30,
} as const;

const text = (max: number) => ({ type: "string", description: `Non-empty plain text, at most ${max} characters.` });
const list = (items: Record<string, unknown>, note = "") =>
  ({ type: "array", items, description: `${note}At most ${MAX.items} items.` });
const texts = list(text(MAX.item));
const scoreField = {
  type: "number",
  description: "Score from 0 (weakest) to 100 (strongest). Use the 0-100 scale, never 0-10.",
};
function shape(properties: Record<string, unknown>) {
  return {
    type: "object", properties, required: Object.keys(properties), additionalProperties: false,
  };
}
export const OUTPUT_SCHEMAS: Record<AgentKey, Record<string, unknown>> = {
  idea_capture: shape({
    title: text(MAX.title), logline: text(MAX.logline), synopsis: text(MAX.synopsis),
    genre: text(MAX.genre), tone: texts, themes: texts, characters: texts, language: text(MAX.language),
  }),
  market_scout: shape({
    audience: text(MAX.audience), comparableTitles: texts,
    insights: list(shape({
      claim: text(MAX.claim),
      sourceUrl: { type: ["string", "null"], description: "An exact HTTPS URL copied from the evidence, or null." },
      evidenceStatus: { type: "string", enum: ["sourced", "unverified", "unavailable"] },
    })),
    limitations: texts,
  }),
  premise_scorer: shape({
    overall: scoreField,
    dimensions: list(shape({
      category: text(MAX.category), score: scoreField, explanation: text(MAX.explanation),
    }), "Between 3 and 6 scoring dimensions. "),
    suggestions: texts,
  }),
  ip_scout: shape({
    status: { type: "string", enum: ["flagged", "needs_review", "no_reference_detected"] },
    concerns: texts, rightsToVerify: texts,
    legalClearanceGranted: { type: "boolean", description: "Always false." },
  }),
};

function fail(path: string, issue: string, detail: string): never {
  throw new AgentValidationError(path + " " + detail, path, issue);
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined || value === null) fail(path, "missing", "is required");
  if (typeof value !== "object" || Array.isArray(value)) fail(path, "wrong_type", "must be an object");
  return value as Record<string, unknown>;
}
function string(value: unknown, path: string, max: number): string {
  if (value === undefined || value === null) fail(path, "missing", "is required");
  if (typeof value !== "string") fail(path, "wrong_type", "must be text");
  if (!value.trim()) fail(path, "empty", "must not be empty");
  if (value.length > max) fail(path, "too_long", `must be at most ${max} characters`);
  return value.trim();
}
function array(value: unknown, path: string): unknown[] {
  if (value === undefined || value === null) fail(path, "missing", "is required");
  if (!Array.isArray(value)) fail(path, "wrong_type", "must be an array");
  if (value.length > MAX.items) fail(path, "too_many", `must have at most ${MAX.items} items`);
  return value;
}
function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((v, i) => string(v, `${path}[${i}]`, MAX.item));
}
function score(value: unknown, path: string): number {
  if (value === undefined || value === null) fail(path, "missing", "is required");
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "wrong_type", "must be a number");
  if (value < 0 || value > 100) fail(path, "out_of_range", "must be between 0 and 100");
  return value;
}
function httpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password && value.length <= 2048;
  } catch { return false; }
}

/**
 * Extract whole HTTPS URLs from untrusted search evidence. Substring checks are
 * unsafe: https://example.com is a prefix of https://example.com/report.
 * Trim punctuation outside links, but never truncate a path to make it match.
 * A URL's presence is provenance only, NOT independent claim verification.
 */
function evidenceUrls(evidence: string): Set<string> {
  const found = evidence.match(/https:\/\/[^\s)\]>"']+/g) ?? [];
  return new Set(found
    .map((value) => value.replace(/[.,;!?]+$/, ""))
    .filter(httpsUrl));
}

/** Validate model output at runtime even if the provider claims strict JSON. */
export function validateOutput<K extends AgentKey>(
  key: K, raw: unknown, researchEvidence = "",
): AgentOutputs[K] {
  const obj = record(raw, "$");

  if (key === "idea_capture") {
    return {
      title: string(obj.title, "title", MAX.title),
      logline: string(obj.logline, "logline", MAX.logline),
      synopsis: string(obj.synopsis, "synopsis", MAX.synopsis),
      genre: string(obj.genre, "genre", MAX.genre),
      tone: stringArray(obj.tone, "tone"),
      themes: stringArray(obj.themes, "themes"),
      characters: stringArray(obj.characters, "characters"),
      language: string(obj.language, "language", MAX.language),
    } as AgentOutputs[K];
  }

  if (key === "market_scout") {
    const urls = evidenceUrls(researchEvidence);
    const insights: MarketInsight[] = array(obj.insights, "insights").map((value, i) => {
      const path = `insights[${i}]`;
      const item = record(value, path);
      const claim = string(item.claim, path + ".claim", MAX.claim);
      const status = item.evidenceStatus;
      if (status !== "sourced" && status !== "unverified" && status !== "unavailable") {
        fail(path + ".evidenceStatus", "invalid_enum", "is not a supported evidence status");
      }
      const url = item.sourceUrl === null || item.sourceUrl === undefined
        ? null : string(item.sourceUrl, path + ".sourceUrl", MAX.url);
      // Keep a URL only if it appears verbatim in the retrieved evidence. An
      // unsupported "sourced" claim is demoted, never kept and never rejected
      // into a retry loop: the claim stays but is labelled unverified.
      const sourceUrl = url !== null && urls.has(url) ? url : null;
      return { claim, sourceUrl, evidenceStatus: status === "sourced" && !sourceUrl ? "unverified" : status };
    });
    return {
      audience: string(obj.audience, "audience", MAX.audience),
      comparableTitles: stringArray(obj.comparableTitles, "comparableTitles"),
      insights,
      limitations: stringArray(obj.limitations, "limitations"),
    } as AgentOutputs[K];
  }

  if (key === "premise_scorer") {
    const dimensions = array(obj.dimensions, "dimensions").map((v, i) => {
      const path = `dimensions[${i}]`;
      const dim = record(v, path);
      return { category: string(dim.category, path + ".category", MAX.category),
        score: score(dim.score, path + ".score"),
        explanation: string(dim.explanation, path + ".explanation", MAX.explanation) };
    });
    if (dimensions.length < 3) fail("dimensions", "too_few", "needs three or more scoring dimensions");
    return {
      overall: score(obj.overall, "overall"),
      dimensions, suggestions: stringArray(obj.suggestions, "suggestions"),
    } as AgentOutputs[K];
  }

  if (key === "ip_scout") {
    if (obj.status !== "flagged" && obj.status !== "needs_review" && obj.status !== "no_reference_detected") {
      fail("status", obj.status === undefined ? "missing" : "invalid_enum", "is not a valid IP review state");
    }
    if (obj.legalClearanceGranted !== false) {
      fail("legalClearanceGranted", "forbidden_value", "must be false; agents never grant legal clearance");
    }
    return {
      status: obj.status, concerns: stringArray(obj.concerns, "concerns"),
      rightsToVerify: stringArray(obj.rightsToVerify, "rightsToVerify"),
      legalClearanceGranted: false,
    } as AgentOutputs[K];
  }
  throw new AgentValidationError("Unsupported agent");
}
