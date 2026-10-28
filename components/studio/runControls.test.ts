import assert from "node:assert/strict";
import { test } from "node:test";
import { runControls, idleAdvanceMessage, cancelErrorMessage, retryRemaining, runNotice, stepMessage } from "./runControls.ts";
import type { HomeProgress, HomeStep } from "./home-run-types.ts";

const step = (status: HomeStep["status"], error_code: string | null = null): HomeStep =>
  ({ id: "step", agent_key: "idea_capture", status, attempts: 1, output: null,
    model: null, error_code, next_attempt_at: null });
const run = (status: string, steps: HomeStep[], cancelled = false): HomeProgress =>
  ({ run: { id: "run", status, cancel_requested_at: cancelled ? "2026-10-26T10:00:00Z" : null,
    finished_at: null }, steps });

test("cancel requested permits advance for database cancellation finalization", () => {
  const result = runControls(run("running", [step("queued")], true), false);
  assert.equal(result.cancelled, true);
  assert.equal(result.canAdvance, true);
});
test("running step permits a new claim attempt to recover expired lease", () => {
  assert.equal(runControls(run("running", [step("running")]), false).canAdvance, true);
});
test("error code without a future retry time does not block Continue", () => {
  const result = runControls(run("running", [step("queued", "rate_limited")]), false);
  assert.equal(result.waiting, false);
  assert.equal(result.canAdvance, true);
});
test("terminal and busy runs block execution, unfinished finalization remains enabled", () => {
  assert.equal(runControls(run("completed", [step("completed")]), false).canAdvance, false);
  assert.equal(runControls(run("running", [step("queued")]), true).canAdvance, false);
  assert.equal(runControls(run("running", [step("completed")]), false).canAdvance, true);
});

test("future retry deadline blocks another model attempt until eligible", () => {
  const p = run("running", [{ ...step("queued", "rate_limited"), next_attempt_at: "2026-10-26T10:01:00Z" }]);
  assert.equal(runControls(p, false, Date.parse("2026-10-26T10:00:00Z")).waiting, true);
  assert.equal(runControls(p, false, Date.parse("2026-10-26T10:00:00Z")).canAdvance, false);
  assert.equal(runControls(p, false, Date.parse("2026-10-26T10:01:00Z")).canAdvance, true);
});

test("cancellation finalization remains available even during retry cooldown", () => {
  const p = run("running", [{ ...step("queued", "rate_limited"), next_attempt_at: "2026-10-26T10:01:00Z" }], true);
  assert.equal(runControls(p, false, Date.parse("2026-10-26T10:00:00Z")).canAdvance, true);
});

test("idle after cancellation finalization does not produce a false error", () => {
  assert.equal(idleAdvanceMessage("idle", run("cancelled", [step("skipped")])), null);
});
test("idle with a running step displays guidance", () => {
  assert.match(idleAdvanceMessage("idle", run("running", [step("running")])) ?? "", /not ready/);
});
test("idle after exhausted step does not claim the next queued step is blocked", () => {
  assert.equal(idleAdvanceMessage("idle", run("running", [step("failed"), step("queued")])), null);
});
test("idle terminal cleanup and exhausted steps do not display retry guidance", () => {
  assert.equal(idleAdvanceMessage("idle", run("completed", [step("completed")])), null);
  assert.equal(idleAdvanceMessage("idle", run("running", [step("failed")])), null);
  assert.equal(idleAdvanceMessage("executed", run("running", [step("queued")])), null);
});

test("all failed steps in running run permit server finalization", () => {
  assert.equal(runControls(run("running", [step("failed")]), false).canAdvance, true);
});

test("cancel response lost but run already terminal is not an error", () => {
  assert.equal(cancelErrorMessage("request failed", run("completed", [step("completed")])), null);
});
test("cancel response lost but cancel request persisted is not an error", () => {
  assert.equal(cancelErrorMessage("request failed", run("running", [step("queued")], true)), null);
});
test("failed cancel with no recorded request preserves error", () => {
  assert.equal(cancelErrorMessage("request failed", run("running", [step("queued")])), "request failed");
});

test("retry countdown switches from minutes to seconds in the final minute and never goes negative", () => {
  const cases: [number, string][] = [[120000, "2 min"], [90000, "2 min"], [60000, "1 min"], [59999, "60 sec"],
    [30000, "30 sec"], [5000, "5 sec"], [1000, "1 sec"], [1, "1 sec"], [0, "0 sec"], [-1000, "0 sec"], [NaN, "0 sec"]];
  for (const [ms, label] of cases) assert.equal(retryRemaining(ms), label, `${ms} ms`);
});
test("retry countdown decreases and unblocks Continue exactly at the deadline", () => {
  const deadline = Date.parse("2026-10-26T10:01:30Z");
  const p = run("running", [{ ...step("queued", "rate_limited"), next_attempt_at: "2026-10-26T10:01:30Z" }]);
  const at = (msLeft: number) => runControls(p, false, deadline - msLeft);
  assert.equal(retryRemaining(at(90000).retryAt! - (deadline - 90000)), "2 min");
  assert.equal(retryRemaining(at(45000).retryAt! - (deadline - 45000)), "45 sec");
  assert.equal(at(1).waiting, true);
  assert.equal(at(1).canAdvance, false);
  assert.equal(at(0).waiting, false);
  assert.equal(at(0).canAdvance, true);
  assert.equal(at(-1000).canAdvance, true);
});
test("terminal run cannot execute another agent even after a retry deadline", () => {
  const p = run("failed", [{ ...step("queued", "rate_limited"), next_attempt_at: "2026-10-26T10:01:00Z" }]);
  assert.equal(runControls(p, false, Date.parse("2026-10-26T10:02:00Z")).canAdvance, false);
});

const agent = (agent_key: HomeStep["agent_key"], status: HomeStep["status"], error_code: string | null = null, attempts = 1): HomeStep =>
  ({ ...step(status, error_code), id: agent_key, agent_key, attempts });

test("failed and skipped agents get plain-language messages instead of raw codes", () => {
  assert.equal(stepMessage(agent("premise_scorer", "failed", "agent_validation", 3)),
    "Premise Scorer returned an invalid response and could not complete after 3 attempts.");
  assert.equal(stepMessage(agent("market_scout", "queued", "rate_limited", 1)),
    "Market Scout was paused because the AI service is rate-limited. Continue when the wait ends.");
  assert.equal(stepMessage(agent("market_scout", "queued", "agent_validation", 1)),
    "Market Scout returned an invalid response. Retry 2 of 3 is scheduled.");
  assert.equal(stepMessage(agent("ip_scout", "skipped", "prerequisite_failed")),
    "IP Scout did not run because an earlier agent failed.");
  assert.equal(stepMessage(agent("idea_capture", "failed", "some_new_code", 1)),
    "Idea Capture hit an unexpected error and could not complete after 1 attempt.");
  assert.equal(stepMessage(agent("idea_capture", "completed")), null);
  assert.equal(stepMessage(agent("ip_scout", "skipped")), null, "cancellation skips need no failure text");
});

test("a failed agent marks the run stopped, never complete, and still lets the server finalize it", () => {
  const steps = [agent("idea_capture", "completed"), agent("market_scout", "completed"),
    agent("premise_scorer", "failed", "agent_validation", 3), agent("ip_scout", "queued")];
  const legacy = run("running", steps);
  const controls = runControls(legacy, false);
  assert.equal(controls.stopped, true);
  assert.equal(controls.canAdvance, true);
  assert.match(runNotice(legacy) ?? "", /Premise Scorer failed, so later agents will not run/);

  const settled = run("partial", [...steps.slice(0, 3), agent("ip_scout", "skipped", "prerequisite_failed")]);
  assert.equal(runControls(settled, false).canAdvance, false);
  assert.equal(runControls(settled, false).stopped, false, "a terminal run needs no finalize button");
  assert.match(runNotice(settled) ?? "", /Run stopped at Premise Scorer\. Completed results are kept/);
  assert.equal(settled.steps.filter(s => s.status === "completed").length, 2, "count stays honest: 2/4");
  assert.equal(runNotice(run("completed", [agent("idea_capture", "completed")])), null);
});
