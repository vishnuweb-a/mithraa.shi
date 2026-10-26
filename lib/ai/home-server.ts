import "server-only";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { HomeRequestError, executionIsEnabled, approvedHomeTestUser } from "./home-http.ts";
export { translateDbError } from "./home-db-errors.ts";

/**
 * The checked-in generated DB types predate Phase 1C.1.
 * Isolate the compatibility cast here; regenerate database.types.ts from a
 * LOCAL Supabase stack before a subsequent typed schema refactor.
 */
export async function requireHomeUser(): Promise<{ userId: string; db: SupabaseClient }> {
  const db = await createSessionClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user || user.is_anonymous) throw new HomeRequestError(401, "authentication_required");
  return { userId: user.id, db: db as unknown as SupabaseClient };
}

/** Server-only. Legacy Supabase service_role JWT required by the worker RPCs. */
export function createWorkerClient(): SupabaseClient {
  if (typeof window !== "undefined") throw new Error("Worker credential is server-only");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.trim() || !key?.trim()) throw new HomeRequestError(503, "worker_not_configured");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "mithraa-home-runner" } },
  });
}

export function requireHomeExecution(): void {
  if (process.env.HOME_GROQ_EXECUTION_ENABLED !== "true") {
    throw new HomeRequestError(503, "agent_execution_disabled");
  }
  // Exactly the same trimmed-secret gate used by the unit tests.
  if (!executionIsEnabled()) {
    throw new HomeRequestError(503, "agent_execution_not_configured");
  }
}

export function jsonPrivate(data: unknown, status = 200): Response {
  return Response.json(data, {
    status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export function respondHomeError(error: unknown): Response {
  if (error instanceof HomeRequestError) {
    return jsonPrivate({ error: error.code }, error.status);
  }
  // Never surface raw PostgREST or upstream errors (which may contain a story).
  return jsonPrivate({ error: "internal_error" }, 500);
}


/** Only the designated test account can trigger paid Groq requests. */
export function requireHomeTestUser(userId: string): void {
  if (!approvedHomeTestUser(userId)) {
    throw new HomeRequestError(403, "agent_execution_restricted");
  }
}
