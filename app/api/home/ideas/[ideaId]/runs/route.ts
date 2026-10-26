import { HomeRequestError, parseQueueOptions, readJsonObject, requireSameOrigin, requireUuid } from "@/lib/ai/home-http";
import { jsonPrivate, requireHomeExecution, requireHomeUser, respondHomeError, translateDbError } from "@/lib/ai/home-server";


/** Queue an owner-scoped, idempotent run. This does not invoke Groq. */
export async function POST(request: Request, context: { params: Promise<{ ideaId: string }> }): Promise<Response> {
  try {
    requireSameOrigin(request);
    requireHomeExecution();
    const { userId, db } = await requireHomeUser();
    const ideaId = requireUuid((await context.params).ideaId);
    const options = parseQueueOptions(await readJsonObject(request, 3000));
    const { data: idea, error: ideaError } = await db.from("idea_drafts")
      .select("id").eq("id", ideaId).eq("owner_id", userId).maybeSingle();
    if (ideaError) throw translateDbError(ideaError);
    if (!idea) throw new HomeRequestError(404, "idea_not_found");
    const { data: runId, error } = await db.rpc("queue_idea_agent_run", {
      p_idea_id: ideaId,
      p_idempotency_key: options.idempotencyKey,
      p_model_mode: options.mode,
      p_request_options: options.requestOptions,
    });
    if (error) throw translateDbError(error);
    return jsonPrivate({ runId, status: "queued" }, 202);
  } catch (error) { return respondHomeError(error); }
}
