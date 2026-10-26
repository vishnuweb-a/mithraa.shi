import { requireUuid } from "@/lib/ai/home-http";
import { HomeRequestError } from "@/lib/ai/home-http";
import { jsonPrivate, requireHomeUser, respondHomeError, translateDbError } from "@/lib/ai/home-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only owner status endpoint for future polling UI. */
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }): Promise<Response> {
  try {
    const { userId, db } = await requireHomeUser();
    const runId = requireUuid((await context.params).runId);
    const { data: run, error } = await db.from("agent_runs")
      .select("id,idea_id,idea_version,status,model_mode,cancel_requested_at,created_at,started_at,finished_at")
      .eq("id", runId).eq("owner_id", userId).maybeSingle();
    if (error) throw translateDbError(error);
    if (!run) throw new HomeRequestError(404, "run_not_found");
    const { data: steps, error: stepsError } = await db.from("agent_steps")
      .select("id,agent_key,status,attempts,output,provider,model,prompt_version,error_code,created_at,started_at,finished_at,next_attempt_at")
      .eq("run_id", runId);
    if (stepsError) throw translateDbError(stepsError);
    return jsonPrivate({
      run,
      steps: (steps ?? []).sort((a: { agent_key: string }, b: { agent_key: string }) =>
        ["idea_capture", "market_scout", "premise_scorer", "ip_scout"].indexOf(a.agent_key) -
        ["idea_capture", "market_scout", "premise_scorer", "ip_scout"].indexOf(b.agent_key)),
    });
  } catch (error) { return respondHomeError(error); }
}
