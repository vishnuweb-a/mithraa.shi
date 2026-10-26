"use client";

import { AiTag } from "@/components/ui";
import { LIVE_AGENTS, outputFor } from "./useHomeRun";
import type { useHomeRun } from "./useHomeRun";

type Controller = ReturnType<typeof useHomeRun>;

export function LiveRunCard({ controller }: { controller: Controller }) {
  const { progress, busy, error, runId, terminal, advance, cancel, reset } = controller;
  const idea = outputFor(progress, "idea_capture");
  const market = outputFor(progress, "market_scout");
  const score = outputFor(progress, "premise_scorer");
  const ip = outputFor(progress, "ip_scout");
  const completed = progress?.steps.filter(s => s.status === "completed").length ?? 0;
  const next = progress?.steps.find(s => s.status !== "completed" && s.status !== "cancelled" && s.status !== "failed");
  const retryAt = next?.next_attempt_at ? Date.parse(next.next_attempt_at) : NaN;
  const waiting = Number.isFinite(retryAt) && retryAt > Date.now();
  const cancelled = Boolean(progress?.run.cancel_requested_at);
  const canAdvance = Boolean(runId && progress && !terminal && !cancelled && !busy && !waiting &&
    next && next.status !== "running");
  const title = idea?.title ?? "Your idea is queued";

  return (
    <article aria-live="polite" className="rise w-full max-w-[880px] overflow-hidden rounded-[22px] bg-[var(--sheet)]">
      <div className="flex flex-col gap-5 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[12px] muted">Live AI · Idea Card</span>
            <h2 className="display mt-2 text-[35px] md:text-[46px]">{title}</h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--ink-2)]">
              {idea?.logline ?? "Run Idea Capture to generate a film premise."}
            </p>
          </div>
          <AiTag accepted={false} />
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--rule)] pt-4 text-[13px]">
          <Fact label="Genre" value={idea?.genre ?? "Pending"} />
          <Fact label="Premise score" value={score ? String(score.overall) + "/100" : "Pending"} />
          <Fact label="Market" value={market?.audience ?? "Pending research"} />
          <Fact label="Rights" value={ip ? (ip.status === "no_reference_detected" ? "No reference detected · not legal clearance" : "Needs human review") : "Pending review"} />
        </dl>
        <ol className="flex flex-wrap gap-1.5" aria-label="Agent execution status">
          {LIVE_AGENTS.map(a => {
            const step = progress?.steps.find(s => s.agent_key === a.key);
            const status = step?.status ?? "queued";
            return (
              <li key={a.key} className={`rounded-[9px] px-2.5 py-1 text-[12px] ${status === "completed" ? "bg-white/[0.05] text-[var(--ink-2)]" : status === "running" ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--faint)]"}`}>
                {status === "completed" ? "✓" : status === "running" ? "◌" : "·"} {a.name} · {status.replaceAll("_", " ")}
              </li>
            );
          })}
        </ol>
        {market && (
          <section className="border-t border-[var(--rule)] pt-4 text-[13px]">
            <h3 className="font-semibold">Market Scout findings</h3>
            <p className="mt-2 text-[var(--ink-2)]">{market.audience}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {market.insights.map((item, i) => (
                <li key={i} className="rounded-[10px] bg-[var(--sheet-3)] p-3">
                  <p>{item.claim}</p>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    {item.evidenceStatus} · Source candidate only, independently unverified
                  </p>
                  {item.sourceUrl && <a className="break-all text-[var(--brand)] underline" href={item.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">View referenced URL</a>}
                </li>
              ))}
            </ul>
            {market.limitations.length > 0 && <p className="mt-3 text-[var(--muted)]">Limitations: {market.limitations.join("; ")}</p>}
          </section>
        )}
        {score && <section className="border-t border-[var(--rule)] pt-4 text-[13px]">
          <h3 className="font-semibold">Premise evaluation · {score.overall}/100</h3>
          <ul className="mt-2 space-y-2">{score.dimensions.map((d,i) => <li key={i}><strong>{d.category} — {d.score}/100:</strong> {d.explanation}</li>)}</ul>
          <p className="mt-2 text-[var(--muted)]">Suggestions: {score.suggestions.join("; ")}</p>
        </section>}
        {ip && <section className="border-t border-[var(--rule)] pt-4 text-[13px]">
          <h3 className="font-semibold">IP screening — {ip.status.replaceAll("_", " ")}</h3>
          <p className="mt-2 text-[var(--muted)]">Automated screening is not legal clearance. Human rights review is required.</p>
          <ul className="mt-2 list-inside list-disc">{ip.concerns.concat(ip.rightsToVerify).map((v,i) => <li key={i}>{v}</li>)}</ul>
        </section>}
        {error && <p role="alert" className="rounded-[10px] bg-red-500/10 p-3 text-[13px] text-red-300">{error}</p>}
        {progress?.steps.filter(s => s.error_code).map(s => <p role="status" className="text-[12px] text-[var(--muted)]" key={s.id}>{s.agent_key}: {s.error_code} (attempt {s.attempts})</p>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--rule)] bg-[var(--sheet-2)] px-5 py-4 md:px-6">
        <div className="text-[12px] text-[var(--muted)]">
          <strong className="text-[var(--ink)]">{completed}/4 agents complete</strong>
          <span className="ml-2">· {progress?.run.status ?? "Loading run"}{cancelled ? " · cancellation requested" : ""}</span>
          {waiting && next?.next_attempt_at && <p>Retry allowed after {new Date(next.next_attempt_at).toLocaleString()}</p>}
          <p className="mt-1">No automatic Groq calls: each Continue executes at most one step.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {terminal && <button type="button" className="btn" onClick={reset}>New idea</button>}
          {!terminal && <button type="button" className="btn" onClick={() => void cancel()} disabled={busy || cancelled || !progress}>Cancel</button>}
          {!terminal && <button type="button" className="btn btn-primary" onClick={() => void advance()} disabled={!canAdvance}>
            {busy ? "Processing…" : waiting ? "Waiting for retry" : "Continue next agent"}
          </button>}
        </div>
      </div>
    </article>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-0.5"><dt className="text-[12px] muted">{label}</dt><dd className="font-medium">{value}</dd></div>;
}
