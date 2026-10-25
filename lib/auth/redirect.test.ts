import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "./redirect.ts";

test("keeps same-origin paths", () => {
  assert.equal(safeNext("/stages/prep"), "/stages/prep");
  assert.equal(safeNext("/brain?tab=log#top"), "/brain?tab=log#top");
});

test("rejects anything that could leave the origin", () => {
  for (const bad of [
    null,
    undefined,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "javascript:alert(1)",
    "evil.example",
    "%2F%2Fevil.example",
  ]) {
    const out = safeNext(bad);
    assert.ok(out.startsWith("/") && !out.startsWith("//"), `${JSON.stringify(bad)} -> ${out}`);
    assert.equal(new URL(out, "http://app.test").origin, "http://app.test", `${JSON.stringify(bad)} -> ${out}`);
  }
  assert.equal(safeNext("https://evil.example"), "/");
  assert.equal(safeNext("/\t/evil.example"), "/");
});

test("never sends a signed-in user back to an auth page", () => {
  assert.equal(safeNext("/login"), "/");
  assert.equal(safeNext("/signup?x=1"), "/");
  assert.equal(safeNext("/auth/callback?code=x"), "/");
});
