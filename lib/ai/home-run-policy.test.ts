import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderRequestError } from "./providers/groq.ts";
import { HomeRequestError } from "./home-http.ts";
import { AgentValidationError, type AgentExecution } from "./contracts.ts";
import { classifyAgentFailure, marketSourceCandidates, storedRunRouting } from "./home-run-policy.ts";

test("HTTP 429 honors Retry-After, transient 5xx/408/425 and schema validation retry", () => {
  assert.deepEqual(classifyAgentFailure(new ProviderRequestError("limited", 429, 22)), {
    code: "rate_limited", retryable: true, retryAfterSeconds: 22,
  });
  assert.deepEqual(classifyAgentFailure(new ProviderRequestError("invalid output", 400, null, "json_validate_failed")), {
    code: "json_validate_failed", retryable: true, retryAfterSeconds: null,
  });
  for (const status of [408, 425, 500, 503]) {
    assert.equal(classifyAgentFailure(new ProviderRequestError("unavailable", status)).retryable, true);
  }
});

test("provider auth/other 4xx are terminal, timeouts are transient", () => {
  for (const status of [400, 401, 403, 404, 413, 422]) {
    const failure = classifyAgentFailure(new ProviderRequestError("Groq request rejected", status));
    assert.equal(failure.retryable, false, String(status));
  }
  assert.equal(classifyAgentFailure(new ProviderRequestError("Groq request timed out")).retryable, true);
  assert.equal(classifyAgentFailure(new ProviderRequestError("Groq network request failed")).retryable, true);
  assert.equal(classifyAgentFailure(new AgentValidationError("Model output invalid")).retryable, true);
});

test("input/DB invariant errors never trigger a paid retry", () => {
  const failure = classifyAgentFailure(new HomeRequestError(400, "unsupported_run_model"));
  assert.deepEqual(failure, { code: "unsupported_run_model", retryable: false, retryAfterSeconds: null });
  assert.equal(classifyAgentFailure(new Error("unknown")).retryable, false);
});

test("persisted model pins from direct Supabase RPCs must still match allowlist", () => {
  for (const request_options of [
    { pinnedModel: "untrusted/paid-model" }, {},
    { pinnedModel: 17 }, { pinnedModel: "" },
  ]) {
    assert.throws(
      () => storedRunRouting({ model_mode: "pinned", request_options }),
      (error: unknown) => error instanceof HomeRequestError && error.code.startsWith("unsupported_run_"),
    );
  }
  assert.throws(() => storedRunRouting({
    model_mode: "compare", request_options: {},
  }), HomeRequestError);
  assert.throws(() => storedRunRouting({
    model_mode: "auto", request_options: { pinnedModel: "openai/gpt-oss-20b" },
  }), HomeRequestError);
  assert.deepEqual(storedRunRouting({
    model_mode: "pinned", request_options: { pinnedModel: "openai/gpt-oss-20b" },
  }), { mode: "pinned", pinnedModel: "openai/gpt-oss-20b" });
  assert.deepEqual(storedRunRouting({ model_mode: "auto", request_options: {} }), { mode: "auto" });
});

function marketRun(insights: Array<{
  claim: string;
  sourceUrl: string | null;
  evidenceStatus: "sourced" | "unverified" | "unavailable";
}>, evidence: string): AgentExecution {
  return {
    key: "market_scout",
    provider: "fake", model: "test", promptVersion: "home-agents-v1",
    usage: { inputTokens: 1, outputTokens: 1, source: "provider" },
    evidence,
    output: {
      audience: "Potential audience unknown",
      comparableTitles: [],
      limitations: ["Unverified sources"],
      insights,
    },
  };
}

test("source persistence deduplicates exact URLs and excludes unsourced claims", () => {
  const url = "https://research.example/report";
  const x = marketSourceCandidates(marketRun([
    { claim: "First claim", sourceUrl: url, evidenceStatus: "sourced" },
    { claim: "Repeat", sourceUrl: url, evidenceStatus: "sourced" },
    { claim: "Not verified", sourceUrl: "https://example.org/unverified", evidenceStatus: "unverified" },
    { claim: "Unavailable", sourceUrl: null, evidenceStatus: "unavailable" },
  ], "Evidence was retrieved from " + url));
  assert.equal(x.length, 1);
  assert.equal(x[0].url, url);
  assert.equal(x[0].claim, "First claim");
});

test("source candidates enforce the DB limit and reject invented URLs", () => {
  const urls = Array.from({ length: 23 }, (_, i) => "https://research.example/report/" + i);
  const insights = urls.map((url) => ({
    claim: "Example " + url, sourceUrl: url,
    evidenceStatus: "sourced" as const,
  }));
  const entries = marketSourceCandidates(marketRun(insights, urls.join("\n")));
  assert.equal(entries.length, 20);
  assert.equal(entries[19].url, urls[19]);
  assert.throws(() => marketSourceCandidates(marketRun([
    { claim: "An invented source", sourceUrl: "https://attacker.example/made-up", evidenceStatus: "sourced" },
  ], "The source https://research.example/actual was found.")), AgentValidationError);
});

test("non-Market-Scout results cannot create source records", () => {
  const input = marketRun([], "");
  assert.deepEqual(marketSourceCandidates({ ...input, key: "idea_capture" }), []);
});
