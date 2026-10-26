import { test } from "node:test";
import assert from "node:assert/strict";
import { runHomeAgent } from "./agents.ts";
import {
  AgentValidationError, type AgentKey, type IdeaInput, type ModelProvider,
} from "./contracts.ts";
import { GroqProvider, ProviderRequestError } from "./providers/groq.ts";
import { selectGroqModel } from "./router.ts";
import { validateOutput } from "./schemas.ts";

const input: IdeaInput = {
  originalText: "A fisherwoman discovers a lost island with a secret archive.",
  languageCode: "ta",
  templateKey: "theatrical_feature",
  productionMode: "hybrid",
  qualityTier: "premium",
};

const idea = {
  title: "The Archive", logline: "A fisherwoman protects the secrets of a lost island.",
  synopsis: "A fisherwoman finds evidence that could change her town.",
  genre: "Mystery", tone: ["Suspenseful"], themes: ["Memory"],
  characters: ["The fisherwoman"], language: "Tamil",
};
const market = {
  audience: "Possible regional mystery audience",
  comparableTitles: ["Example film"], insights: [{
    claim: "Audience measurements unavailable", sourceUrl: null, evidenceStatus: "unavailable",
  }], limitations: ["No official audience figures were found"],
};
const premise = {
  overall: 75, dimensions: [
    { category: "Conflict", score: 80, explanation: "The dilemma is clear" },
    { category: "Character", score: 70, explanation: "Needs stronger motive" },
    { category: "Originality", score: 75, explanation: "Interesting central twist" },
  ], suggestions: ["Clarify the final choice"],
};
const ip = {
  status: "needs_review", concerns: ["Check real-life references"],
  rightsToVerify: ["Story source"], legalClearanceGranted: false,
};

function fakeProvider(overrides: Partial<Record<AgentKey, unknown>> = {}): ModelProvider {
  const result: Record<AgentKey, unknown> = {
    idea_capture: idea, market_scout: market, premise_scorer: premise, ip_scout: ip,
    ...overrides,
  };
  return {
    name: "fake",
    async research({ model }) {
      return { model, data: "No verifiable URL or statistics found.", usage: {
        inputTokens: 9, outputTokens: 10, source: "provider" as const,
      } };
    },
    async generateStructured({ model, schemaName }) {
      const agent = schemaName.replace(/^shi_/, "").replace(/_v1$/, "") as AgentKey;
      return { model, data: result[agent], usage: {
        inputTokens: 100, outputTokens: 45, source: "provider" as const,
      } };
    },
  };
}

test("all four agents call a provider and return validated results", async () => {
  for (const key of ["idea_capture", "market_scout", "premise_scorer", "ip_scout"] as const) {
    const result = await runHomeAgent(key, input, { provider: fakeProvider() });
    assert.equal(result.key, key);
    assert.equal(result.provider, "fake");
    assert.ok(result.output);
    assert.equal(result.usage.source, "provider");
  }
});

test("Market Scout aggregates search and extraction token usage", async () => {
  const result = await runHomeAgent("market_scout", input, { provider: fakeProvider() });
  assert.equal(result.usage.inputTokens, 109);
  assert.equal(result.usage.outputTokens, 55);
  assert.match(result.evidence ?? "", /No verifiable/);
});

test("market claims are not allowed to invent sourced URLs", () => {
  assert.throws(() => validateOutput("market_scout", {
    ...market,
    insights: [{ claim: "Over 500% growth", sourceUrl: "https://example.test/made-up", evidenceStatus: "sourced" }],
  }, "No direct links appeared in the research."), AgentValidationError);
});

test("Market Scout allows an evidence URL only when present in the returned research", () => {
  const data = validateOutput("market_scout", {
    ...market,
    insights: [{ claim: "A report was found", sourceUrl: "https://example.test/report", evidenceStatus: "sourced" }],
  }, "See https://example.test/report for a report.");
  assert.equal(data.insights[0].evidenceStatus, "sourced");
});

test("a domain or truncated URL cannot impersonate a full source page", () => {
  const evidence = "Search found https://www.imdb.com/title/tt0123456/ and https://site.com/report";
  for (const wrongUrl of [
    "https://www.imdb.com",
    "https://www.imdb.com/title",
    "https://site.com/rep",
  ]) {
    assert.throws(() => validateOutput("market_scout", {
      ...market, insights: [{ claim: "Unsupported claim", sourceUrl: wrongUrl, evidenceStatus: "sourced" }],
    }, evidence), AgentValidationError, wrongUrl);
  }
});

test("extracting complete URLs accepts legitimate source pages with surrounding punctuation", () => {
  const exact = "https://example.test/research?year=2026";
  const data = validateOutput("market_scout", {
    ...market,
    insights: [{ claim: "A specific research report exists", sourceUrl: exact, evidenceStatus: "sourced" }],
  }, "See (" + exact + "). Further research is needed.");
  assert.equal(data.insights[0].sourceUrl, exact);
});

test("the IP agent may never grant legal clearance", () => {
  assert.throws(() => validateOutput("ip_scout", {
    ...ip, legalClearanceGranted: true,
  }), AgentValidationError);
});

test("premise score validation rejects unsupported or impossible numbers", () => {
  assert.throws(() => validateOutput("premise_scorer", {
    ...premise, overall: 105,
  }), AgentValidationError);
});

test("the SHI Router has clear budget, quality and pinned models", () => {
  assert.equal(selectGroqModel({ agent: "idea_capture", mode: "auto", qualityTier: "draft" }), "openai/gpt-oss-20b");
  assert.equal(selectGroqModel({ agent: "ip_scout", mode: "auto", qualityTier: "premium" }), "openai/gpt-oss-120b");
  assert.equal(selectGroqModel({ agent: "ip_scout", mode: "budget_first", qualityTier: "master" }), "openai/gpt-oss-20b");
  assert.equal(selectGroqModel({ agent: "idea_capture", mode: "quality_first", qualityTier: "draft" }), "openai/gpt-oss-120b");
  assert.equal(selectGroqModel({ agent: "idea_capture", mode: "pinned", qualityTier: "draft",
    pinnedModel: "openai/gpt-oss-120b" }), "openai/gpt-oss-120b");
});

test("not-yet-implemented Compare is never silently faked", async () => {
  await assert.rejects(runHomeAgent("idea_capture", input, {
    provider: fakeProvider(), mode: "compare",
  }), AgentValidationError);
});

test("invalid idea inputs are rejected before calling a model", async () => {
  await assert.rejects(runHomeAgent("idea_capture", {
    ...input, originalText: " ",
  }, { provider: fakeProvider() }), AgentValidationError);
  await assert.rejects(runHomeAgent("idea_capture", {
    ...input, templateKey: "fake_template",
  }, { provider: fakeProvider() }), AgentValidationError);
});

test("Groq structured outputs use a strict JSON schema and do not activate browser search", async () => {
  let body: Record<string, unknown> = {};
  const mockFetch: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer fake-secret");
    return new Response(JSON.stringify({
      model: "openai/gpt-oss-20b", choices: [{ message: { content: JSON.stringify(idea) } }],
      usage: { prompt_tokens: 15, completion_tokens: 25 },
    }), { status: 200 });
  };
  const provider = new GroqProvider({ apiKey: "fake-secret", fetchImpl: mockFetch });
  const result = await provider.generateStructured({
    model: "openai/gpt-oss-20b", system: "System", user: "User",
    schemaName: "shi_idea_capture_v1", schema: { type: "object" },
  });
  assert.deepEqual(result.data, idea);
  assert.equal(result.usage.inputTokens, 15);
  assert.equal((body.response_format as { json_schema: { strict: boolean } }).json_schema.strict, true);
  assert.equal(body.tools, undefined);
});

test("Groq browser research uses search without structured output", async () => {
  let body: Record<string, unknown> = {};
  const provider = new GroqProvider({
    apiKey: "fake-secret",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "Evidence unavailable" } }] }), { status: 200 });
    },
  });
  const result = await provider.research({ model: "openai/gpt-oss-20b", query: "Film market research" });
  assert.equal(result.data, "Evidence unavailable");
  assert.deepEqual(body.tools, [{ type: "browser_search" }]);
  assert.equal(body.response_format, undefined);
});

test("Groq exposes rate limiting without leaking provider payloads or credentials", async () => {
  const provider = new GroqProvider({
    apiKey: "fake-secret",
    fetchImpl: async () => new Response('{"secret":"fake-secret"}', {
      status: 429, headers: { "retry-after": "12" },
    }),
  });
  await assert.rejects(provider.research({ model: "openai/gpt-oss-20b", query: "Test" }), (err: unknown) => {
    assert.ok(err instanceof ProviderRequestError);
    assert.equal(err.status, 429);
    assert.equal(err.retryAfterSeconds, 12);
    assert.ok(!err.message.includes("fake-secret"));
    return true;
  });
});

test("Groq does not attempt requests when the server API key is missing", async () => {
  let invoked = false;
  const provider = new GroqProvider({ apiKey: "", fetchImpl: async () => {
    invoked = true;
    throw new Error("should not be called");
  } });
  await assert.rejects(provider.research({ model: "openai/gpt-oss-20b", query: "Test" }), ProviderRequestError);
  assert.equal(invoked, false);
});

test("Groq preserves a safe JSON-validation failure code without leaking the error body", async () => {
  const provider = new GroqProvider({
    apiKey: "fake-secret",
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: "json_validate_failed",
        message: "Secret prompt material fake-secret and private user data",
      },
    }), { status: 400 }),
  });
  await assert.rejects(provider.research({ model: "openai/gpt-oss-20b", query: "Test" }), (err: unknown) => {
    assert.ok(err instanceof ProviderRequestError);
    assert.equal(err.status, 400);
    assert.equal(err.providerCode, "json_validate_failed");
    assert.equal(err.message, "Groq request rejected");
    assert.ok(!JSON.stringify({ message: err.message, providerCode: err.providerCode }).includes("fake-secret"));
    return true;
  });
});

test("Groq rejects unsafe provider error codes instead of echoing provider messages", async () => {
  const provider = new GroqProvider({
    apiKey: "fake-secret",
    fetchImpl: async () => new Response(JSON.stringify({
      error: { code: "invalid request fake-secret", message: "Internal trace" },
    }), { status: 400 }),
  });
  await assert.rejects(provider.research({ model: "openai/gpt-oss-20b", query: "Test" }), (err: unknown) => {
    assert.ok(err instanceof ProviderRequestError);
    assert.equal(err.providerCode, null);
    assert.equal(err.message, "Groq request rejected");
    return true;
  });
});

test("user cancellation while downloading the response body is reported as cancellation", async () => {
  const controller = new AbortController();
  const provider = new GroqProvider({
    apiKey: "fake-secret",
    fetchImpl: async () => {
      const response = new Response('{"choices":[]}', { status: 200 });
      Object.defineProperty(response, "text", {
        value: async () => {
          controller.abort();
          throw new DOMException("aborted", "AbortError");
        },
      });
      return response;
    },
  });
  await assert.rejects(provider.research({
    model: "openai/gpt-oss-20b", query: "Test", signal: controller.signal,
  }), (err: unknown) => {
    assert.ok(err instanceof ProviderRequestError);
    assert.equal(err.message, "Groq request cancelled");
    return true;
  });
});

test("user cancellation while downloading a 400 error body is also reported as cancellation", async () => {
  const controller = new AbortController();
  const provider = new GroqProvider({
    apiKey: "fake-secret",
    fetchImpl: async () => {
      const response = new Response('{"error":{}}', { status: 400 });
      Object.defineProperty(response, "text", {
        value: async () => {
          controller.abort();
          throw new DOMException("aborted", "AbortError");
        },
      });
      return response;
    },
  });
  await assert.rejects(provider.research({
    model: "openai/gpt-oss-20b", query: "Test", signal: controller.signal,
  }), (err: unknown) => {
    assert.ok(err instanceof ProviderRequestError);
    assert.equal(err.message, "Groq request cancelled");
    return true;
  });
});
