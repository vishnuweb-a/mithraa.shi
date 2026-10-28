import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AgentValidationError, type AgentExecution, type AgentKey } from "./contracts.ts";
import { HomeRequestError } from "./home-http.ts";
import { executeRunStep } from "./home-runner.ts";
import { runHomeAgent } from "./agents.ts";

const runId = "f3000000-0000-4000-8000-000000000001";
const ownerId = "f3000000-0000-4000-8000-000000000002";
const ideaId = "f3000000-0000-4000-8000-000000000003";
const stepId = "f3000000-0000-4000-8000-000000000004";
const token = "f3000000-0000-4000-8000-000000000005";
const model = "openai/gpt-oss-20b";

const originalApprovedUser = process.env.HOME_GROQ_TEST_USER_ID;
beforeEach(() => {
  // Every normal runner test uses an approved session. The denial test below
  // deliberately clears or changes this variable after beforeEach.
  process.env.HOME_GROQ_TEST_USER_ID = ownerId;
});
after(() => {
  if (originalApprovedUser === undefined) delete process.env.HOME_GROQ_TEST_USER_ID;
  else process.env.HOME_GROQ_TEST_USER_ID = originalApprovedUser;
});

function fixture(options: {
  mode?: string; pinnedModel?: unknown; leaseRunId?: string;
  preflightError?: boolean; ownerFound?: boolean; leaseGranted?: boolean;
  finishAccepted?: boolean; agentKey?: AgentKey; cancelRequested?: boolean;
  steps?: Array<Record<string, unknown>>;
} = {}) {
  const finished: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  const runFilters: Array<[string, unknown]> = [];
  const storedRun = {
    id: runId, owner_id: ownerId, idea_id: ideaId, idea_version: 1,
    status: "queued", model_mode: options.mode ?? "pinned",
    request_options: { pinnedModel: options.pinnedModel ?? model },
    cancel_requested_at: options.cancelRequested ? "2026-10-28T10:00:00Z" : null,
  };
  const records: Record<string, unknown> = {
    agent_runs: options.ownerFound === false ? null : storedRun,
    idea_drafts: {
      language_code: "en", template_key: "theatrical_feature",
      production_mode: "shot", quality_tier: "standard",
    },
    idea_versions: { original_text: "A story about an impossible voyage" },
    agent_steps: null,
  };
  const db = {
    from(table: string) {
      calls.push("read:" + table);
      const q = {
        select(_columns: string) { return q; },
        eq(col: string, value: unknown) {
          if (table === "agent_runs") runFilters.push([col, value]);
          return q;
        },
        async single() {
          if (table === "idea_drafts" && options.preflightError) {
            return { data: null, error: { code: "PGRST116", message: "temporary failure" } };
          }
          return { data: records[table], error: null };
        },
        async maybeSingle() { return { data: records[table], error: null }; },
        // List reads (agent_steps for a run) are awaited on the builder itself.
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: options.steps ?? [{ id: stepId, agent_key: "idea_capture", status: "running" }],
            error: null }).then(resolve);
        },
      };
      return q;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push("rpc:" + name);
      if (name === "claim_home_agent_step") {
        return { data: options.leaseGranted === false ? [] : [{
          step_id: stepId,
          claimed_run_id: options.leaseRunId ?? runId,
          agent_key: options.agentKey ?? "idea_capture", lease_token: token, attempt_number: 1,
        }], error: null };
      }
      if (name === "finish_home_agent_step") {
        finished.push(args);
        return { data: options.finishAccepted !== false, error: null };
      }
      throw Error("Unexpected RPC " + name);
    },
  };
  return { db: db as unknown as SupabaseClient, calls, finished, runFilters };
}

const agentResult: AgentExecution<"idea_capture"> = {
  key: "idea_capture",
  output: {
    title: "Voyage", logline: "An unlikely traveler",
    synopsis: "A fictional journey", genre: "Drama",
    tone: ["hopeful"], themes: ["discovery"], characters: ["The Traveler"], language: "en",
  },
  provider: "groq", model, promptVersion: "home-agents-v1",
  usage: { inputTokens: 11, outputTokens: 22, source: "provider" },
};

test("privileged runner denies missing and wrong approved user before any DB or Groq call", async () => {
  for (const approved of [undefined, "f3000000-0000-4000-8000-000000000006", " "]) {
    if (approved === undefined) delete process.env.HOME_GROQ_TEST_USER_ID;
    else process.env.HOME_GROQ_TEST_USER_ID = approved;
    const fx = fixture();
    let providerCalls = 0;
    await assert.rejects(
      executeRunStep(runId, ownerId, {
        db: fx.db,
        runAgent: (async () => { providerCalls++; return agentResult; }) as typeof runHomeAgent,
      }),
      (error: unknown) => error instanceof HomeRequestError &&
        error.status === 403 && error.code === "agent_execution_restricted",
    );
    assert.deepEqual(fx.calls, [], "no privileged DB query or RPC is allowed");
    assert.deepEqual(fx.finished, [], "no writes are allowed");
    assert.equal(providerCalls, 0, "no paid provider call is allowed");
  }
});

test("bad pin injected directly into queued RPC fails before Groq and cannot retry", async () => {
  const fx = fixture({ pinnedModel: "unapproved/paid-model" });
  let calls = 0;
  const result = await executeRunStep(runId, ownerId, {
    db: fx.db,
    runAgent: (async () => { calls++; return agentResult; }) as typeof runHomeAgent,
  });
  assert.equal(calls, 0);
  assert.deepEqual(result, {
    state: "executed", agent: "idea_capture", outcome: "failed",
    errorCode: "unsupported_run_model",
  });
  assert.equal(fx.finished.length, 1);
  assert.equal(fx.finished[0].p_outcome, "failed");
  assert.equal(fx.finished[0].p_retryable, false);
  assert.equal(fx.finished[0].p_lease_token, token);
  assert.deepEqual(fx.calls.slice(0, 2), ["read:agent_runs", "rpc:claim_home_agent_step"]);
});

test("valid pinned model is passed to Groq and persisted once under the leased token", async () => {
  const fx = fixture();
  let calls = 0;
  const result = await executeRunStep(runId, ownerId, {
    db: fx.db,
    runAgent: (async (_key, _input, opts) => {
      calls++;
      assert.ok(opts);
      assert.equal(opts.mode, "pinned");
      assert.equal(opts.pinnedModel, model);
      return agentResult;
    }) as typeof runHomeAgent,
  });
  assert.equal(calls, 1);
  assert.equal(result.state, "executed");
  assert.equal(result.outcome, "completed");
  assert.equal(fx.finished.length, 1);
  assert.equal(fx.finished[0].p_outcome, "completed");
  assert.equal(fx.finished[0].p_lease_token, token);
  assert.equal(fx.finished[0].p_model, model);
  assert.equal(fx.finished[0].p_input_tokens, 11);
  assert.equal(fx.finished[0].p_output_tokens, 22);
  assert.ok(fx.calls.indexOf("rpc:claim_home_agent_step") < fx.calls.indexOf("rpc:finish_home_agent_step"));
});

test("temporary Supabase read failures schedule retry without calling Groq", async () => {
  const fx = fixture({ preflightError: true });
  let calls = 0;
  const result = await executeRunStep(runId, ownerId, {
    db: fx.db, runAgent: (async () => { calls++; return agentResult; }) as typeof runHomeAgent,
  });
  assert.equal(calls, 0);
  assert.equal(result.state, "retry_scheduled");
  assert.equal(fx.finished[0].p_error_code, "run_input_unavailable");
  assert.equal(fx.finished[0].p_retryable, true);
});

test("wrong run ID in returned lease cannot trigger a Groq call", async () => {
  const fx = fixture({ leaseRunId: "f3000000-0000-4000-8000-000000000006" });
  let calls = 0;
  await assert.rejects(
    executeRunStep(runId, ownerId, {
      db: fx.db, runAgent: (async () => { calls++; return agentResult; }) as typeof runHomeAgent,
    }),
    (error: unknown) => error instanceof HomeRequestError && error.code === "worker_claim_mismatch",
  );
  assert.equal(calls, 0);
  assert.equal(fx.finished.length, 0);
});

test("lost lease cannot save results twice, and an unavailable claim does no work", async () => {
  const lost = fixture({ finishAccepted: false });
  const result = await executeRunStep(runId, ownerId, {
    db: lost.db, runAgent: (async () => agentResult) as typeof runHomeAgent,
  });
  assert.equal(result.state, "lease_lost");
  assert.equal(lost.finished.length, 1);

  const waiting = fixture({ leaseGranted: false });
  let calls = 0;
  const idle = await executeRunStep(runId, ownerId, {
    db: waiting.db, runAgent: (async () => { calls++; return agentResult; }) as typeof runHomeAgent,
  });
  assert.equal(idle.state, "idle");
  assert.equal(calls, 0);
});

test("cross-owner lookups cannot reach the privileged claim operation", async () => {
  const fx = fixture({ ownerFound: false });
  await assert.rejects(executeRunStep(runId, ownerId, { db: fx.db }), 
    (error: unknown) => error instanceof HomeRequestError && error.code === "run_not_found");
  assert.deepEqual(fx.runFilters, [["id", runId], ["owner_id", ownerId]],
    "The privileged run lookup must filter by both run ID and verified session owner ID");
  assert.equal(fx.calls.includes("rpc:claim_home_agent_step"), false);
});

const ideaOut = agentResult.output;
const marketOut = {
  audience: "Regional mystery audience", comparableTitles: ["Example"],
  insights: [{ claim: "No audience data found", sourceUrl: null, evidenceStatus: "unavailable" }],
  limitations: ["Unverified"],
};
const premiseOut = {
  overall: 72, suggestions: ["Sharpen the ending"], dimensions: [
    { category: "Conflict", score: 70, explanation: "Clear" },
    { category: "Character", score: 74, explanation: "Grounded" },
    { category: "Originality", score: 72, explanation: "Fresh setting" },
  ],
};
const done = (agent_key: string, output: unknown) => ({ id: agent_key, agent_key, status: "completed", output });
const leased = (agent_key: string, extra: Record<string, unknown> = {}) =>
  ({ id: stepId, agent_key, status: "running", output: null, ...extra });
const quiet = () => undefined;

test("a downstream agent never calls Groq when an earlier agent failed or has no output", async () => {
  for (const steps of [
    [done("idea_capture", ideaOut), { id: "m", agent_key: "market_scout", status: "failed", output: null }, leased("premise_scorer")],
    [done("idea_capture", ideaOut), done("market_scout", null), leased("premise_scorer")],
    [leased("premise_scorer")],
  ]) {
    const fx = fixture({ agentKey: "premise_scorer", steps });
    let calls = 0;
    const result = await executeRunStep(runId, ownerId, {
      db: fx.db, log: quiet, runAgent: (async () => { calls++; return agentResult; }) as typeof runHomeAgent,
    });
    assert.equal(calls, 0);
    assert.equal(result.errorCode, "prerequisite_missing");
    assert.equal(fx.finished[0].p_retryable, false, "a missing prerequisite is never retried");
  }
});

test("corrupt persisted upstream output stops the run instead of retrying a paid call", async () => {
  const fx = fixture({ agentKey: "market_scout", steps: [done("idea_capture", { title: "Only a title" }), leased("market_scout")] });
  let calls = 0;
  const result = await executeRunStep(runId, ownerId, {
    db: fx.db, log: quiet, runAgent: (async () => { calls++; return agentResult; }) as typeof runHomeAgent,
  });
  assert.equal(calls, 0);
  assert.equal(result.errorCode, "prerequisite_invalid");
  assert.equal(fx.finished[0].p_retryable, false);
});

test("each agent receives the validated, persisted outputs of every earlier agent", async () => {
  const fx = fixture({ agentKey: "ip_scout", steps: [
    done("idea_capture", ideaOut), done("market_scout", marketOut), done("premise_scorer", premiseOut), leased("ip_scout"),
  ] });
  let seen: unknown;
  await executeRunStep(runId, ownerId, {
    db: fx.db, log: quiet,
    runAgent: (async (key, _input, opts) => { assert.equal(key, "ip_scout"); seen = opts?.preceding; return agentResult; }) as typeof runHomeAgent,
  });
  assert.deepEqual(seen, { idea_capture: ideaOut, market_scout: marketOut, premise_scorer: premiseOut });
});

test("a validation failure stores its path for the corrective retry and counts its tokens", async () => {
  const fx = fixture({ agentKey: "premise_scorer", steps: [
    done("idea_capture", ideaOut), done("market_scout", marketOut), leased("premise_scorer"),
  ] });
  const logs: Array<Record<string, unknown>> = [];
  const result = await executeRunStep(runId, ownerId, {
    db: fx.db, log: (r) => logs.push(r),
    runAgent: (async (_key, _input, opts) => {
      opts?.onCall?.({ kind: "generate", provider: "groq", model, requestId: "req_abc", finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 40, source: "provider" }, durationMs: 5 });
      throw new AgentValidationError("too long", "dimensions[1].explanation", "too_long");
    }) as typeof runHomeAgent,
  });
  assert.equal(result.state, "retry_scheduled");
  assert.equal(result.errorCode, "agent_validation");
  assert.equal(fx.finished[0].p_error_detail, "too_long@dimensions[1].explanation");
  assert.equal(fx.finished[0].p_input_tokens, 100);
  assert.equal(fx.finished[0].p_output_tokens, 40);
  assert.equal(fx.finished[0].p_provider, "groq");
  assert.deepEqual(logs[0], {
    event: "home_agent_attempt", run_id: runId, agent_key: "premise_scorer", attempt_number: 1,
    outcome: "failed", error_category: "agent_validation", retryable: true,
    validation_failure_path: "dimensions[1].explanation", validation_failure_code: "too_long",
    model, provider_request_ids: ["req_abc"], response_finish_reasons: ["stop"],
    input_tokens: 100, output_token_usage: 40, duration_ms: logs[0].duration_ms,
  });
  assert.ok(!JSON.stringify(logs).includes("impossible voyage"), "diagnostics never include the story");
});

test("the next attempt receives the previous validator detail", async () => {
  const fx = fixture({ steps: [leased("idea_capture", { error_message: "too_long@synopsis" })] });
  let issue: unknown;
  await executeRunStep(runId, ownerId, {
    db: fx.db, log: quiet, runAgent: (async (_k, _i, opts) => { issue = opts?.previousIssue; return agentResult; }) as typeof runHomeAgent,
  });
  assert.equal(issue, "too_long@synopsis");
});

test("cancellation requested mid-step stops any further model request", async () => {
  const fx = fixture({ cancelRequested: true });
  let calls = 0;
  const result = await executeRunStep(runId, ownerId, {
    db: fx.db, log: quiet,
    runAgent: (async (_k, _i, opts) => { await opts?.beforeCall?.(); calls++; return agentResult; }) as typeof runHomeAgent,
  });
  assert.equal(calls, 0);
  assert.equal(result.errorCode, "run_cancelled");
  assert.equal(fx.finished[0].p_retryable, false);
});

test("duplicate clicks: only the request holding the lease reaches Groq", async () => {
  const fx = fixture();
  let granted = false;
  const db = Object.assign(Object.create(fx.db), {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "claim_home_agent_step" && granted) return { data: [], error: null };
      if (name === "claim_home_agent_step") granted = true;
      return fx.db.rpc(name, args);
    },
  }) as SupabaseClient;
  let calls = 0;
  const runAgent = (async () => { calls++; return agentResult; }) as typeof runHomeAgent;
  const results = await Promise.all([1, 2].map(() => executeRunStep(runId, ownerId, { db, log: quiet, runAgent })));
  assert.equal(calls, 1);
  assert.deepEqual(results.map((r) => r.state).sort(), ["executed", "idle"]);
  assert.equal(fx.finished.length, 1);
});
