# Phase 1C.2 — Groq-backed Home agents (provider integration)

**Scope:** real provider integration and independently testable agents. This phase does **not** ship a public API route, background worker, browser UI, or live Groq test. Those are staged as 1C.3–1C.4.

## Architecture

```text
Home (future 1C.4)
  -> Authenticated, quota-checked runner (future 1C.3)
      -> runHomeAgent(agentKey, validatedIdea, { mode, preceding, signal })
          -> SHI Router (allowlisted models; no arbitrary client model IDs)
          -> ModelProvider interface
              -> GroqProvider (only adapter in 1C.2)
                  -> chat completions + strict JSON schema
                  -> market research through a separate browser-search call
          -> runtime validation + model provenance + token usage
      -> Persist into agent_steps / research_sources / agent_usage (future 1C.3)
```

Files:
- `lib/ai/contracts.ts`: provider-neutral interface, idea input, execution/usage and output types.
- `lib/ai/providers/groq.ts`: server-only, direct fetch to Groq chat completions, private key, timeout and rate-limit errors.
- `lib/ai/router.ts`: initial Auto, Budget-first, Quality-first and approved Pinned routing.
- `lib/ai/schemas.ts`: strict JSON schemas and independent runtime validation.
- `lib/ai/agents.ts`: four prompts and single-agent executor.
- `lib/ai/agents.test.ts`: dependency-free mocked transport/provider unit tests.

## Agent responsibilities

| Agent | Input | Output | Model policy |
| --- | --- | --- | --- |
| Idea Capture | user story + format/language/style | title, logline, synopsis, characters, themes | GPT-OSS 20B, unless quality-first/pinned |
| Market Scout | idea + browser-search evidence | audience, comparables, sourced/unverified/unavailable insights, limitations | GPT-OSS 20B, unless quality-first/pinned |
| Premise Scorer | story + optional prior Idea Card | explained rubric scores (0–100) and improvements | GPT-OSS 120B for premium/master auto; 20B for budget-first |
| IP Scout | story + optional prior Idea Card | flagged/needs_review/no_reference_detected, rights checks | GPT-OSS 120B for premium/master auto; 20B for budget-first |

Market research uses **two separate provider calls**: search with `tools:[{type:"browser_search"}]` and `tool_choice:"required"`, then structured extraction using a JSON schema. Groq does not support browser tools and strict structured outputs within the same request. The model may lack browser search access on a specific free account: propagate a real provider error; do **not** fall back to invented market statistics or silently label them sourced.

Only an **exact whole HTTPS URL extracted from search evidence** can be attached to a sourced market insight; partial paths and bare-domain prefixes are rejected. Even when an HTTPS URL appears inside search evidence, it is a **source candidate**, not a human-verified claim. Phase 1C.3 must persist it in `research_sources` with `verified=false` unless independently checked; the UI must show clear provenance/limitations. The provider does not claim an independent live verification.

IP screening is not legal clearance. The validator rejects `legalClearanceGranted=true` and requires an explicit review state; agents must never change Project Brain approval gates.

## Groq security and limits

- Only use `GROQ_API_KEY` on the server. It is read at call time and never returned in output.
- No model calls or secret access from a client component. No key in `NEXT_PUBLIC_*`, repository or PR.
- Model IDs are restricted to `openai/gpt-oss-20b` and `openai/gpt-oss-120b`.
- `compare` mode explicitly throws until Phase 1C.3 has safe multi-run limits and cost policy.
- Fixed 25-second request deadline, including response body download, with separate user-cancel and timeout outcomes. A 429 exception includes `retryAfterSeconds`, handled by the forthcoming worker. For other HTTP 400 responses, a short allowlisted-format `providerCode` (such as `json_validate_failed`) can guide retry policy; complete Groq error messages are never forwarded.
- Access control, per-user 10-run limit, exactly-once database queueing, and run-cancellation flag remain in the already deployed Phase 1C.1 schema.
- These calls must only be invoked after authenticating a real user and enforcing database run ownership/quota in Phase 1C.3.
- Provider token usage is returned as measured or unavailable; no fabricated pricing/credit-wallet debits.
- Static prompts versioned `home-agents-v1`. Output JSON schema validated at runtime even with strict-mode provider output.
- External model providers can implement `ModelProvider` without changing the agent prompt/output contract.

Current Groq reference docs:
- [Models](https://console.groq.com/docs/models)
- [Structured outputs](https://console.groq.com/docs/structured-outputs)
- [Browser search](https://console.groq.com/docs/tool-use/built-in-tools/browser-search)
- [Free plan limits](https://console.groq.com/docs/rate-limits)

## Tests and acceptance

`npm run test:unit` executes existing auth unit tests and the new AI unit tests. AI tests exercise all four agents via a fake provider, model selection, runtime schema and IP safeguards, **exact-match evidence URL checks** (including malicious bare-domain/partial-path cases), combined research/extraction token usage, real Groq request payload shapes, retry-after parsing, server-key absence, sanitized HTTP 400 error codes and response-download cancellation. They **do not** make real Groq calls. The AI unit suite contains **19 tests**, including the 6 added during Ponytail remediation.

Before merging: require CI typecheck, lint, unit tests, build, existing local Supabase pgTAP/concurrency tests and browser E2E. Ponytail-review the entire PR.

### Phase 1C.3 handoff — still necessary before production

1. Server-authenticated `/api/home/...` route(s) and trusted database writer, with server-only Supabase service credentials. No RPC authentication from the client can complete a run.
2. Claim a queued agent run, avoid duplicate workers, persist each step's real state/usage, enforce timeout, 429 backoff, retries and cancelled requests.
3. Implement a durable or resumable short-request worker compatible with Vercel's request lifecycle; never pretend an in-memory timer is a real queue.
4. Save actual validated agent output, prompt version, provider, model and evidence records in existing 1C.1 tables.
5. Add a real-key, quota-controlled staging smoke test; never commit a key or run paid/free quota against CI unapproved.
6. Only after 1C.3 connects them, replace `components/studio/ideaEngine.ts` and `useRun.ts` with production execution. The deterministic prototype must not be presented as live AI.

**Explicit release status:** This phase adds actual Groq provider code but **does not** by itself make the Home UI operational.
