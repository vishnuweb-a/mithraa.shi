import { HomeRequestError, requireSameOrigin, requireUuid } from "@/lib/ai/home-http";
import { jsonPrivate, requireHomeUser, respondHomeError, translateDbError } from "@/lib/ai/home-server";


/** Only the owner can request cancellation; the DB worker finalizes state. */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }): Promise<Response> {
  try {
    requireSameOrigin(request);
    const { userId, db } = await requireHomeUser();
    const runId = requireUuid((await context.params).runId);
    const { data: found, error: findError } = await db.from("agent_runs")
      .select("id").eq("id", runId).eq("owner_id", userId).maybeSingle();
    if (findError) throw translateDbError(findError);
    if (!found) throw new HomeRequestError(404, "run_not_found");
    const { error } = await db.rpc("request_idea_run_cancel", { p_run_id: runId });
    if (error) throw translateDbError(error);
    return jsonPrivate({ runId, cancelRequested: true }, 202);
  } catch (error) { return respondHomeError(error); }
}
