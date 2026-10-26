import { HomeRequestError } from "./home-http.ts";

/** Shared, safe PostgREST error mapping used by API routes and worker. */
export function translateDbError(error: { code?: string; message?: string } | null): HomeRequestError {
  switch (error?.code) {
    case "23505": return new HomeRequestError(409, "run_already_active");
    case "42501": return new HomeRequestError(404, "resource_unavailable");
    case "22023": return new HomeRequestError(400, "invalid_run_request");
    case "P0001":
      if (error?.message?.includes("Daily agent run limit")) {
        return new HomeRequestError(429, "daily_run_limit");
      }
      return new HomeRequestError(409, "run_request_unavailable");
    default: return new HomeRequestError(500, "database_operation_failed");
  }
}
