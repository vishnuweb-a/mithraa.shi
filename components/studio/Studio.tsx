"use client";

import Link from "next/link";
import { useState } from "react";
import { Still, type Scene } from "@/components/media/Still";
import { PROJECT, STAGES } from "@/lib/data";
import { EXAMPLES } from "./ideaEngine";
import { useHomeRun } from "./useHomeRun";
import { LiveRunCard } from "./LiveRunCard";

/** Setting tiles across the top of the composer, like a film setup. */
const SETTINGS: { k: string; icon: string; tint: string; options: string[] }[] = [
  { k: "Source", icon: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3", tint: "#e0457b", options: ["Voice note", "One line", "News clipping", "Book"] },
  { k: "Language", icon: "M4 5h9M8 3v2m3 0c-1 5-4 8-7 9m3-5c1 2 3 4 6 5M13 21l4-9 4 9m-7-3h6", tint: "#2d5bd8", options: ["Tamil", "Hindi", "Telugu", "Malayalam"] },
  { k: "Format", icon: "M3 6h18v12H3zM7 6v12M17 6v12", tint: "#8a5cf6", options: ["Feature", "Series", "Short"] },
  { k: "Budget", icon: "M6 4h12M6 9h12M9 4c5 0 5 10 0 10H6l8 6", tint: "#f08a24", options: ["₹8–15 Cr", "₹2–8 Cr", "₹15–40 Cr"] },
];

export function Studio() {
  const [text, setText] = useState("");
  const [settings, setSettings] = useState<Record<string, number>>({});
  const run = useHomeRun();
  const active = STAGES.find((s) => s.id === "prep")!;

  const val = (k: string) => {
    const s = SETTINGS.find((x) => x.k === k)!;
    return s.options[(settings[k] ?? 0) % s.options.length];
  };

  const go = () => {
    if (run.busy || run.runId) return;
    const src = val("Source");
    const spark = text.trim() || EXAMPLES.find((e) => e.k === src)?.text || EXAMPLES[0].text;
    if (!text.trim()) setText(spark);
    const language: Record<string, string> = { Tamil: "ta", Hindi: "hi", Telugu: "te", Malayalam: "ml" };
    const source: Record<string, string> = { "Voice note": "voice_note", "One line": "one_line", "News clipping": "news_clipping", Book: "book" };
    const format: Record<string, string> = { Feature: "theatrical_feature", Series: "ott_series", Short: "micro_drama" };
    void run.start({
      originalText: spark,
      languageCode: language[val("Language")] ?? "en",
      templateKey: format[val("Format")] ?? "theatrical_feature",
      productionMode: "shot",
      qualityTier: "standard",
      sourceType: source[src] ?? "one_line",
    });
  };

  const running = run.busy || Boolean(run.runId && !run.terminal);

  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col items-center justify-center gap-8 py-6">
      {!run.runId ? <Hero /> : <LiveRunCard controller={run} />}

      {run.error && !run.runId && <p role="alert" className="w-full max-w-[880px] rounded-[12px] bg-red-500/10 p-3 text-red-300">{run.error}</p>}
      {/* Composer */}
      <div className="w-full max-w-[880px]">
        <div className="flex gap-2 rounded-[22px] bg-[var(--sheet)] p-2">
          <div className="hidden flex-col gap-1.5 sm:flex">
            {[
              { k: "Idea", d: "M12 3a6 6 0 0 0-3 11v3h6v-3a6 6 0 0 0-3-11ZM10 21h4" },
              { k: "Script", d: "M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4" },
            ].map((m, i) => (
              <span key={m.k} className={`flex w-[58px] flex-col items-center gap-1 rounded-[14px] py-2.5 text-[11.5px] ${i === 0 ? "bg-[var(--sheet-3)] text-white" : "text-[var(--muted)]"}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d={m.d} />
                </svg>
                {m.k}
              </span>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
              {SETTINGS.map((s) => (
                <button
                  key={s.k}
                  onClick={() => {
                    const next = ((settings[s.k] ?? 0) + 1) % s.options.length;
                    setSettings((v) => ({ ...v, [s.k]: next }));
                    if (s.k === "Source") setText(EXAMPLES[next]?.text ?? "");
                  }}
                  className="flex min-w-[132px] flex-1 items-center gap-2.5 rounded-[12px] bg-[var(--sheet-3)] px-2.5 py-2 text-left hover:bg-[#2c3035]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]" style={{ background: s.tint }} aria-hidden>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={s.icon} />
                    </svg>
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="text-[11px] text-[var(--muted)]">{s.k}</span>
                    <span className="truncate text-[13px] font-medium">{val(s.k)}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <div className="flex min-w-0 flex-1 flex-col rounded-[14px] bg-[var(--sheet-3)] px-3.5 pt-3 pb-2.5">
                <label htmlFor="spark" className="sr-only">
                  Describe your idea
                </label>
                <textarea
                  id="spark"
                  rows={2}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go();
                  }}
                  placeholder="Describe your idea, or paste a line from a voice note"
                  className="w-full resize-none bg-transparent text-[14.5px] leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--faint)] focus-visible:outline-none"
                />
                <div className="no-scrollbar mt-1.5 flex items-center gap-1.5 overflow-x-auto text-[12px]">
                  <span className="flex shrink-0 items-center gap-1.5 rounded-[8px] bg-black/25 px-2 py-1 text-[var(--ink-2)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" /> Ideate agents
                  </span>
                  <span className="shrink-0 rounded-[8px] bg-black/25 px-2 py-1 text-[var(--ink-2)]">Stops at Gate 1</span>
                  <span className="shrink-0 rounded-[8px] bg-black/25 px-2 py-1 text-[var(--ink-2)]">Owner-controlled live AI</span>
                </div>
              </div>
              <button
                onClick={go}
                disabled={running}
                className="flex w-[112px] shrink-0 flex-col items-center justify-center gap-1 rounded-[14px] bg-[var(--brand)] text-[var(--on-brand)] transition-colors hover:bg-[#dcff55] disabled:opacity-60"
              >
                <span className="title-wide text-[14px]">{run.busy ? "Starting" : running ? "Run active" : "Run agents"}</span>
                <span className="flex items-center gap-1 text-[12px] font-medium">
                  {running ? <span className="h-3 w-3 rounded-full border-2 border-black/25 border-t-black spin" /> : <span aria-hidden>✦</span>} 4
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Continue */}
      {!run.runId && (
        <Link href="/stages/prep" className="group flex w-full max-w-[880px] items-center gap-4 rounded-[18px] border border-[var(--rule)] p-2.5 pr-4 hover:bg-white/[0.03]">
          <span className="media aspect-[16/10] w-[96px] shrink-0 !rounded-[12px]">
            <Still scene="dawn-courtyard" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[12px] muted">Continue</span>
            <span className="truncate text-[14.5px] font-medium">
              {PROJECT.title}, {active.name.toLowerCase()}
            </span>
            <span className="truncate text-[12.5px] text-[var(--ink-2)]">
              <span className="text-[var(--brand)]">●</span> 6 agents running. Gate 6 review in {PROJECT.nextGate.days} days.
            </span>
          </span>
          <span className="ml-auto shrink-0 rounded-[10px] bg-[var(--sheet-3)] px-3 py-1.5 text-[13px] font-medium group-hover:bg-white group-hover:text-black">Open</span>
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const FAN: { scene: Scene; title: string; rot: number; z: number; size: string }[] = [
  { scene: "ferry", title: "Last Ferry", rot: -7, z: 1, size: "w-[118px] sm:w-[160px] md:w-[210px]" },
  { scene: "dawn-courtyard", title: "Kolam", rot: 0, z: 2, size: "w-[150px] sm:w-[200px] md:w-[270px]" },
  { scene: "radio", title: "Radio Thatha", rot: 7, z: 1, size: "w-[118px] sm:w-[160px] md:w-[210px]" },
];

function Hero() {
  return (
    <div className="flex flex-col items-center gap-7">
      <div className="flex max-w-full items-center justify-center overflow-hidden px-2 py-4">
        {FAN.map((f, i) => (
          <div
            key={f.title}
            className={`media aspect-[16/10] ${f.size} shrink-0 !rounded-[14px] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)] ring-1 ring-white/10`}
            style={{ transform: `rotate(${f.rot}deg) translateY(${f.rot ? 10 : 0}px)`, zIndex: f.z, margin: i === 1 ? "0 -26px" : 0 }}
          >
            <Still scene={f.scene} />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,rgba(0,0,0,0.7))]" />
            <span className={`display absolute inset-x-0 bottom-3 text-center text-white ${i === 1 ? "text-[26px] md:text-[34px]" : "hidden text-[18px] sm:block md:text-[22px]"}`}>{f.title}</span>
          </div>
        ))}
      </div>
      <h1 className="display text-center text-[34px] md:text-[48px]">Bring your story to screen</h1>
    </div>
  );
}

