import assert from "node:assert/strict";
import { test } from "node:test";
import { runControls } from "./runControls.ts";
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
test("terminal, busy, and completed steps block execution", () => {
  assert.equal(runControls(run("completed", [step("completed")]), false).canAdvance, false);
  assert.equal(runControls(run("running", [step("queued")]), true).canAdvance, false);
  assert.equal(runControls(run("running", [step("completed")]), false).canAdvance, false);
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
