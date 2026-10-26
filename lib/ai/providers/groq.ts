/**
 * Server-only Groq adapter. Do not import this module from client components.
 * The only credential accepted is GROQ_API_KEY, never NEXT_PUBLIC_*.
 *
 * Docs: https://console.groq.com/docs/api-reference
 * Browser search and strict JSON-schema response formats CANNOT be combined.
 */
import type { ModelProvider, ModelResult, TokenUsage } from "../contracts.ts";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 25_000;

export class ProviderRequestError extends Error {
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  /** Machine-readable Groq error code only; never expose model/provider error messages. */
  readonly providerCode: string | null;
  constructor(
    message: string,
    status: number | null = null,
    retryAfterSeconds: number | null = null,
    providerCode: string | null = null,
  ) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.providerCode = providerCode;
  }
}

type GroqResponse = {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

function usageFrom(raw: GroqResponse): TokenUsage {
  const a = raw.usage?.prompt_tokens;
  const b = raw.usage?.completion_tokens;
  const inputTokens = typeof a === "number" && Number.isSafeInteger(a) && a >= 0 ? a : null;
  const outputTokens = typeof b === "number" && Number.isSafeInteger(b) && b >= 0 ? b : null;
  return { inputTokens, outputTokens,
    source: inputTokens === null || outputTokens === null ? "unavailable" : "provider" };
}

function retryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const numeric = Number(header);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.min(3600, Math.ceil(numeric));
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, Math.min(3600, Math.ceil((date - Date.now()) / 1000)));
}

export class GroqProvider implements ModelProvider {
  readonly name = "groq";
  private readonly key: string | undefined;
  private readonly doFetch: typeof fetch;

  constructor(options: { apiKey?: string; fetchImpl?: typeof fetch } = {}) {
    this.key = options.apiKey ?? process.env.GROQ_API_KEY;
    this.doFetch = options.fetchImpl ?? fetch;
  }

  private async request(body: Record<string, unknown>, signal?: AbortSignal): Promise<GroqResponse> {
    if (typeof window !== "undefined") {
      throw new ProviderRequestError("Groq can only be accessed by the server");
    }
    if (!this.key || !this.key.trim()) {
      throw new ProviderRequestError("GROQ_API_KEY is not configured on the server");
    }

    const deadline = AbortSignal.timeout(TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response: Response;
    try {
      response = await this.doFetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: requestSignal,
        cache: "no-store",
      });
    } catch (error) {
      // No prompt, provider error payload, or credential in exceptions.
      if (signal?.aborted) throw new ProviderRequestError("Groq request cancelled");
      if (deadline.aborted || (error instanceof Error && error.name === "TimeoutError")) {
        throw new ProviderRequestError("Groq request timed out");
      }
      throw new ProviderRequestError("Groq network request failed");
    }

    if (!response.ok) {
      const retry = retryAfterSeconds(response.headers.get("retry-after"));
      if (response.status === 429) throw new ProviderRequestError("Groq rate limit exceeded", 429, retry);
      if (response.status === 401 || response.status === 403) {
        throw new ProviderRequestError("Groq authorization failed; check server model access", response.status);
      }
      if (response.status >= 500) throw new ProviderRequestError("Groq temporarily unavailable", response.status, retry);

      // Invalid request and transient schema validation errors can both be HTTP 400.
      // Only accept a short machine code; never forward the full provider message,
      // prompt or raw response body into logs/UI.
      let providerCode: string | null = null;
      try {
        const raw = await response.text();
        if (raw.length <= 4096) {
          const errorBody: unknown = JSON.parse(raw);
          if (errorBody !== null && typeof errorBody === "object" && "error" in errorBody) {
            const detail = (errorBody as { error?: unknown }).error;
            if (detail !== null && typeof detail === "object" && "code" in detail) {
              const candidate = (detail as { code?: unknown }).code;
              if (typeof candidate === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(candidate)) {
                providerCode = candidate;
              }
            }
          }
        }
      } catch {
        if (signal?.aborted) throw new ProviderRequestError("Groq request cancelled");
        if (deadline.aborted) throw new ProviderRequestError("Groq request timed out");
        // Invalid error payloads must not become client-visible text.
      }
      throw new ProviderRequestError("Groq request rejected", response.status, null, providerCode);
    }

    const size = Number(response.headers.get("content-length"));
    if (Number.isFinite(size) && size > 300_000) {
      throw new ProviderRequestError("Groq response is unexpectedly large");
    }
    let raw: unknown;
    try {
      const bodyText = await response.text();
      if (bodyText.length > 300_000) throw new Error("Oversized");
      raw = JSON.parse(bodyText);
    } catch {
      if (signal?.aborted) throw new ProviderRequestError("Groq request cancelled");
      if (deadline.aborted) throw new ProviderRequestError("Groq request timed out");
      throw new ProviderRequestError("Groq returned an invalid response");
    }
    if (!raw || typeof raw !== "object") throw new ProviderRequestError("Groq response missing object");
    return raw as GroqResponse;
  }

  async generateStructured(input: {
    model: string;
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<ModelResult<unknown>> {
    const res = await this.request({
      model: input.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: input.schemaName, strict: true, schema: input.schema },
      },
      temperature: 0.2,
      max_completion_tokens: 2400,
      reasoning_effort: "low",
      stream: false,
    }, input.signal);

    const content = res.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new ProviderRequestError("Groq structured output was empty");
    let value: unknown;
    try { value = JSON.parse(content); }
    catch { throw new ProviderRequestError("Groq structured output is not JSON"); }
    return { data: value, model: typeof res.model === "string" ? res.model : input.model, usage: usageFrom(res) };
  }

  async research(input: { model: string; query: string; signal?: AbortSignal }): Promise<ModelResult<string>> {
    const res = await this.request({
      model: input.model,
      messages: [
        {
          role: "system",
          content: "Research market context using the browser search tool. Record specific source page URLs when available. Do not invent market numbers, sources, audience statistics or rights clearance. State where evidence is missing.",
        },
        { role: "user", content: input.query },
      ],
      tools: [{ type: "browser_search" }],
      tool_choice: "required",
      max_completion_tokens: 1800,
      reasoning_effort: "low",
      stream: false,
    }, input.signal);
    const content = res.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new ProviderRequestError("Groq browser search returned no evidence");
    }
    return { data: content.slice(0, 16_000), model: typeof res.model === "string" ? res.model : input.model, usage: usageFrom(res) };
  }
}
