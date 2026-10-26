import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HomeRequestError, executionIsEnabled, parseQueueOptions, readJsonObject,
  requireSameOrigin, requireUuid,
} from "./home-http.ts";

test("queue request needs an unpredictable idempotency key", () => {
  assert.throws(() => parseQueueOptions({ idempotencyKey: "too-short" }), HomeRequestError);
  const result = parseQueueOptions({ idempotencyKey: "ticket_secure_nonce_100" });
  assert.equal(result.mode, "auto");
  assert.deepEqual(result.requestOptions, {});
});

test("model routing rejects compare mode and arbitrary model pins", () => {
  for (const body of [
    { idempotencyKey: "ticket_secure_nonce_100", mode: "compare" },
    { idempotencyKey: "ticket_secure_nonce_100", mode: "pinned", pinnedModel: "untrusted/test" },
    { idempotencyKey: "ticket_secure_nonce_100", mode: "auto", pinnedModel: "openai/gpt-oss-20b" },
  ]) {
    assert.throws(() => parseQueueOptions(body), HomeRequestError);
  }
  const pinned = parseQueueOptions({
    idempotencyKey: "ticket_secure_nonce_100",
    mode: "pinned",
    pinnedModel: "openai/gpt-oss-20b",
  });
  assert.equal(pinned.mode, "pinned");
  assert.equal(pinned.requestOptions.pinnedModel, "openai/gpt-oss-20b");
});

test("cross-site requests cannot mutate a user's authenticated Home data", () => {
  assert.throws(() => requireSameOrigin(new Request("https://app.example/api/home/ideas", {
    headers: { Origin: "https://attacker.invalid" },
  })), HomeRequestError);
  assert.throws(() => requireSameOrigin(new Request("https://app.example/api/home/ideas")), HomeRequestError);
  assert.doesNotThrow(() => requireSameOrigin(new Request("https://app.example/api/home/ideas", {
    headers: { Origin: "https://app.example" },
  })));
});

test("request size limit is enforced even without Content-Length", async () => {
  const request = new Request("http://localhost/api/home/ideas", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ originalText: "x".repeat(1000) }),
  });
  await assert.rejects(readJsonObject(request, 200), (error: unknown) => {
    assert.ok(error instanceof HomeRequestError);
    assert.equal(error.code, "body_too_large");
    return true;
  });
});

test("malformed and unsupported JSON requests are rejected", async () => {
  for (const value of ["[]", "false", "{broken"]) {
    await assert.rejects(readJsonObject(new Request("http://localhost/api", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: value,
    })), HomeRequestError);
  }
  await assert.rejects(readJsonObject(new Request("http://localhost/api", {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}",
  })), HomeRequestError);
});

test("execution gate is default-off and requires both private keys", () => {
  const valid = { HOME_GROQ_EXECUTION_ENABLED: "true", GROQ_API_KEY: "key", SUPABASE_SERVICE_ROLE_KEY: "secret" } as NodeJS.ProcessEnv;
  assert.equal(executionIsEnabled({}), false);
  assert.equal(executionIsEnabled({ ...valid, HOME_GROQ_EXECUTION_ENABLED: "false" }), false);
  assert.equal(executionIsEnabled({ ...valid, GROQ_API_KEY: "" }), false);
  assert.equal(executionIsEnabled({ ...valid, SUPABASE_SERVICE_ROLE_KEY: "" }), false);
  assert.equal(executionIsEnabled(valid), true);
});

test("run IDs are constrained to UUIDs before any privileged lookups", () => {
  assert.equal(requireUuid("f3000000-0000-4000-8000-000000000001"), "f3000000-0000-4000-8000-000000000001");
  assert.throws(() => requireUuid("../other-user"), HomeRequestError);
  assert.throws(() => requireUuid("not-a-uuid"), HomeRequestError);
});
