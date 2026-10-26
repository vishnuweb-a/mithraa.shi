import { AgentValidationError, type RoutingMode } from "./contracts.ts";
import { selectGroqModel } from "./router.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{16,128}$/;

export class HomeRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "HomeRequestError";
    this.status = status;
    this.code = code;
  }
}

export function validUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function requireUuid(value: string): string {
  if (!validUuid(value)) throw new HomeRequestError(400, "invalid_id");
  return value;
}

/** Fail closed for cookie-authenticated write requests. */
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected) throw new HomeRequestError(403, "cross_origin_denied");
}

export async function readJsonObject(request: Request, maxBytes = 14_000): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HomeRequestError(415, "json_required");
  }
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new HomeRequestError(413, "body_too_large");
  }
  let text: string;
  try {
    // A bounded stream read, not just Content-Length (which clients may omit).
    const reader = request.body?.getReader();
    if (!reader) throw new HomeRequestError(400, "missing_body");
    const decoder = new TextDecoder();
    let total = 0;
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HomeRequestError(413, "body_too_large");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    text = chunks.join("");
  } catch (error) {
    if (error instanceof HomeRequestError) throw error;
    throw new HomeRequestError(400, "invalid_body");
  }
  try {
    const obj: unknown = JSON.parse(text);
    if (!obj || Array.isArray(obj) || typeof obj !== "object") throw new Error("not_object");
    return obj as Record<string, unknown>;
  } catch {
    throw new HomeRequestError(400, "invalid_json");
  }
}

export function parseQueueOptions(body: Record<string, unknown>): {
  idempotencyKey: string;
  mode: RoutingMode;
  requestOptions: { pinnedModel?: string };
} {
  const idempotencyKey = body.idempotencyKey;
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_RE.test(idempotencyKey)) {
    throw new HomeRequestError(400, "invalid_idempotency_key");
  }
  const mode: unknown = body.mode ?? "auto";
  if (!["auto", "budget_first", "quality_first", "pinned"].includes(String(mode))) {
    throw new HomeRequestError(400, "invalid_model_mode");
  }
  const pinnedModel = body.pinnedModel;
  if (pinnedModel !== undefined && (mode !== "pinned" || typeof pinnedModel !== "string")) {
    throw new HomeRequestError(400, "invalid_pinned_model");
  }
  try {
    // Reuse the provider-level model allowlist; no arbitrary model identifiers.
    selectGroqModel({
      agent: "idea_capture", mode: mode as RoutingMode,
      qualityTier: "standard", pinnedModel: pinnedModel as string | undefined,
    });
  } catch (error) {
    if (error instanceof AgentValidationError) throw new HomeRequestError(400, "invalid_pinned_model");
    throw error;
  }
  return {
    idempotencyKey,
    mode: mode as RoutingMode,
    requestOptions: pinnedModel === undefined ? {} : { pinnedModel: pinnedModel as string },
  };
}

/** This flag prevents accidental billable calls on previews or after deployment. */
export function executionIsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HOME_GROQ_EXECUTION_ENABLED === "true" && Boolean(env.GROQ_API_KEY?.trim()) &&
    Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}
