import { HomeRequestError, requireSameOrigin, requireUuid } from "@/lib/ai/home-http";
import { jsonPrivate, requireHomeExecution, requireHomeUser, respondHomeError } from "@/lib/ai/home-server";
import { executeRunStep } from "@/lib/ai/home-runner";

/** One Market Scout step makes two 25-second Groq requests, plus DB I/O. */
export const maxDuration = 60;

/** Explicit, idempotent-at-the-DB-lease-boundary, owner-initiated work attempt. */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }): Promise<Response> {
  try {
    requireSameOrigin(request);
    requireHomeExecution();
    const { userId } = await requireHomeUser();
    const runId = requireUuid((await context.params).runId);
    const outcome = await executeRunStep(runId, userId);
    return jsonPrivate(outcome, outcome.state === "idle" ? 202 : 200);
  } catch (error) {
    // Credentials, provider error text, or user story never enter the response.
    if (error instanceof HomeRequestError) return respondHomeError(error);
    return respondHomeError(error);
  }
}
