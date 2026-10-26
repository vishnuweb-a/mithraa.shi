import { AgentValidationError, checkIdeaInput, type IdeaInput } from "@/lib/ai/contracts";
import { HomeRequestError, readJsonObject, requireSameOrigin } from "@/lib/ai/home-http";
import { jsonPrivate, requireHomeUser, respondHomeError, translateDbError } from "@/lib/ai/home-server";


const SOURCE_TYPES = new Set(["one_line", "voice_note", "news_clipping", "book"]);

export async function GET(): Promise<Response> {
  try {
    const { userId, db } = await requireHomeUser();
    const { data, error } = await db.from("idea_drafts")
      .select("id,working_title,original_text,language_code,template_key,production_mode,quality_tier,status,current_version,created_at,updated_at")
      .eq("owner_id", userId).order("updated_at", { ascending: false }).limit(30);
    if (error) throw translateDbError(error);
    return jsonPrivate({ ideas: data ?? [] });
  } catch (error) { return respondHomeError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const { db } = await requireHomeUser();
    const data = await readJsonObject(request);
    const options: IdeaInput = {
      originalText: typeof data.originalText === "string" ? data.originalText : "",
      languageCode: typeof data.languageCode === "string" ? data.languageCode : "en",
      templateKey: typeof data.templateKey === "string" ? data.templateKey : "theatrical_feature",
      productionMode: typeof data.productionMode === "string"
        ? data.productionMode as IdeaInput["productionMode"] : "shot",
      qualityTier: typeof data.qualityTier === "string"
        ? data.qualityTier as IdeaInput["qualityTier"] : "standard",
    };
    try { checkIdeaInput(options); }
    catch (err) {
      if (err instanceof AgentValidationError) throw new HomeRequestError(400, "invalid_idea_input");
      throw err;
    }
    const sourceType = data.sourceType ?? "one_line";
    if (typeof sourceType !== "string" || !SOURCE_TYPES.has(sourceType)) {
      throw new HomeRequestError(400, "invalid_source_type");
    }
    const workingTitle = data.workingTitle ?? null;
    if (workingTitle !== null && (typeof workingTitle !== "string" ||
      workingTitle.trim().length < 1 || workingTitle.length > 200)) {
      throw new HomeRequestError(400, "invalid_working_title");
    }
    const { data: ideaId, error } = await db.rpc("create_idea_draft", {
      p_original_text: options.originalText,
      p_working_title: workingTitle,
      p_source_type: sourceType,
      p_language_code: options.languageCode,
      p_template_key: options.templateKey,
      p_production_mode: options.productionMode,
      p_quality_tier: options.qualityTier,
    });
    if (error) throw translateDbError(error);
    return jsonPrivate({ ideaId }, 201);
  } catch (error) { return respondHomeError(error); }
}
