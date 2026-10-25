import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StageView } from "@/components/stages/StageView";
import { STAGES, stageById } from "@/lib/data";

// Unlisted stage ids would otherwise get the PPR fallback shell (HTTP 200) before notFound() runs.
export const ensureStatic = "shell";

export function generateStaticParams() {
  return STAGES.map((s) => ({ stage: s.id }));
}

export async function generateMetadata({ params }: PageProps<"/stages/[stage]">): Promise<Metadata> {
  const { stage } = await params;
  const s = stageById(stage);
  return { title: s ? `${s.n}. ${s.dashboard}` : "Stage" };
}

export default async function StagePage({ params }: PageProps<"/stages/[stage]">) {
  const { stage } = await params;
  const s = stageById(stage);
  if (!s) notFound();
  return <StageView id={s.id} />;
}
