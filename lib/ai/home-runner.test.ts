import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentExecution } from "./contracts.ts";
import { HomeRequestError } from "./home-http.ts";
import { executeRunStep } from "./home-runner.ts";
import { runHomeAgent } from "./agents.ts";

const runId = "f3000000-0000-4000-8000-000000000001";
const ownerId = "f3000000-0000-4000-8000-000000000002";
const ideaId = "f3000000-0000-4000-8000-000000000003";
const stepId = "f3000000-0000-4000-8000-000000000004";
const token = "f3000000-0000-4000-8000-000000000005";
const model = "openai/gpt-oss-20b";

function fixture(options: {
  mode?: string; pinnedModel?: unknown; leaseRunId?: string;
  preflightError?: boolean; ownerFound?: boolean; leaseGranted?: boolean;
  finishAccepted?: boolean;
} = {}) {
  const finished: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  const runFilters: Array<[string, unknown]> = [];
  const storedRun = {
    id: runId, owner_id: ownerId, idea_id: ideaId, idea_version: 1,
    status: "queued", model_mode: options.mode ?? "pinned",
    request_options: { pinnedModel: options.pinnedModel ?? model },
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
      };
      return q;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push("rpc:" + name);
      if (name === "claim_home_agent_step") {
        return { data: options.leaseGranted === false ? [] : [{
          step_id: stepId,
          claimed_run_id: options.leaseRunId ?? runId,
          agent_key: "idea_capture", lease_token: token, attempt_number: 1,
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
