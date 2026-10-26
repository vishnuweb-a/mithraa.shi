import type { AgentKey, AgentOutputs, IdeaInput } from "@/lib/ai/contracts";
export type StepStatus = "queued" | "running" | "completed" | "failed" | "skipped";
export type HomeStep = {
  id: string; agent_key: AgentKey; status: StepStatus; attempts: number;
  output: unknown | null; model: string | null; error_code: string | null;
  next_attempt_at: string | null;
};
export type HomeRun = { id: string; status: string; cancel_requested_at: string | null; finished_at: string | null };
export type HomeProgress = { run: HomeRun; steps: HomeStep[] };
export type HomeIdea = IdeaInput & { sourceType: string; workingTitle?: string };
export type { AgentOutputs };
