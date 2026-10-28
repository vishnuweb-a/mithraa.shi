"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentKey } from "@/lib/ai/contracts";
import { TERMINAL_RUN_STATUSES, idleAdvanceMessage, cancelErrorMessage } from "./runControls";
import type { HomeProgress, HomeIdea, AgentOutputs } from "./home-run-types";
export type { HomeProgress, HomeIdea, HomeStep, HomeRun } from "./home-run-types";
export { LIVE_AGENTS } from "./runControls";

const KEY = "mithraa.home.live-run.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code.replaceAll("_", " "));
  }
}
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  const result: unknown = await response.json().catch(() => ({}));
  const body = result && typeof result === "object" ? result as Record<string, unknown> : {};
  if (!response.ok) throw new ApiError(response.status, typeof body.error === "string" ? body.error : "request_failed");
  return result as T;
}
function post(body?: unknown): RequestInit {
  return { method: "POST", ...(body === undefined ? {} : {
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }) };
}

export function outputFor<K extends AgentKey>(progress: HomeProgress | null, key: K): AgentOutputs[K] | null {
  const step = progress?.steps.find((item) => item.agent_key === key);
  return step?.status === "completed" && step.output && typeof step.output === "object"
    ? step.output as AgentOutputs[K] : null;
}

/** Owner-driven (no background paid calls). The GET poll only observes DB state. */
export function useHomeRun() {
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<HomeProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const pendingIdea = useRef<{ fingerprint: string; ideaId: string; key: string } | null>(null);
  const terminal = Boolean(progress && TERMINAL_RUN_STATUSES.has(progress.run.status));

  const refresh = useCallback(async (id: string) => {
    const next = await api<HomeProgress>(`/api/home/runs/${id}`);
    setProgress(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    // Restore after mount so server and hydration renders match.
    void Promise.resolve().then(() => {
      if (!active) return;
      const previous = sessionStorage.getItem(KEY);
      if (previous && UUID.test(previous)) setRunId(previous);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!runId || terminal) return;
    let alive = true;
    const read = async () => {
      try { await refresh(runId); }
      catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
          sessionStorage.removeItem(KEY);
          setRunId(null); setProgress(null);
        } else setError(e instanceof Error ? e.message : "Unable to load run");
      }
    };
    void read();
    const timer = window.setInterval(() => { if (alive && !lock.current) void read(); }, 4000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [runId, refresh, terminal]);

  const start = useCallback(async (idea: HomeIdea) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const fingerprint = JSON.stringify(idea);
      const cached = pendingIdea.current;
      const ideaId = cached?.fingerprint === fingerprint ? cached.ideaId :
        (await api<{ ideaId: string }>("/api/home/ideas", post(idea))).ideaId;
      const key = cached?.fingerprint === fingerprint ? cached.key : crypto.randomUUID();
      pendingIdea.current = { fingerprint, ideaId, key };
      const queued = await api<{ runId: string }>(
        `/api/home/ideas/${ideaId}/runs`,
        post({ idempotencyKey: key, mode: "budget_first" }),
      );
      pendingIdea.current = null;
      sessionStorage.setItem(KEY, queued.runId);
      setProgress(null); setRunId(queued.runId);
      await refresh(queued.runId);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to start run"); }
    finally { lock.current = false; setBusy(false); }
  }, [refresh]);

  const advance = useCallback(async () => {
    if (!runId || lock.current || terminal) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const response = await api<{ state: string }>(`/api/home/runs/${runId}/advance`, post());
      // GET is authoritative: an idle advance may have finalized cancellation.
      const after = await refresh(runId);
      const message = idleAdvanceMessage(response.state, after);
      if (message) setError(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to advance run");
      try { await refresh(runId); } catch { /* preserve original error */ }
    } finally { lock.current = false; setBusy(false); }
  }, [runId, terminal, refresh]);

  const cancel = useCallback(async () => {
    if (!runId || lock.current || terminal) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      await api(`/api/home/runs/${runId}/cancel`, post());
      await refresh(runId);
    } catch (e) {
      const original = e instanceof Error ? e.message : "Unable to cancel run";
      try {
        const after = await refresh(runId);
        setError(cancelErrorMessage(original, after));
      } catch { setError(original); }
    } finally { lock.current = false; setBusy(false); }
  }, [runId, terminal, refresh]);

  const reset = useCallback(() => {
    if (lock.current) return;
    sessionStorage.removeItem(KEY);
    setRunId(null); setProgress(null); setError(null);
  }, []);

  return { runId, progress, busy, error, start, advance, cancel, reset, terminal };
}
