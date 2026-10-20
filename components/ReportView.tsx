"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import {
  difficultyLabels,
  type Report,
  type StoredSession,
} from "@/lib/types";
import { Icon } from "./Icon";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

const VERDICT: Record<
  Report["verdict"],
  { label: string; className: string }
> = {
  strong: {
    label: "Strong",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  solid: {
    label: "Solid",
    className: "border-[#D9D9D9] bg-[#F3F2EE] text-[#262626]",
  },
  developing: {
    label: "Developing",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
};

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="mt-9">
      <div className="flex items-baseline justify-between border-b border-borderline-light pb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#525252]">
          {title}
        </h2>
        <span className="text-[11px] uppercase tracking-widest text-ink-subtle">
          {count}
        </span>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Evidence({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="border-l-2 border-[#D4D4D4] pl-3 text-[13px] italic leading-relaxed text-[#525252]">
      {children}
    </blockquote>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-borderline bg-canvas-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-subtle">
      {children}
    </p>
  );
}

export function ReportView() {
  const [session, setSession] = useState<StoredSession | null | undefined>(
    undefined,
  );
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("parlay.session");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe read from browser storage
      setSession(raw ? (JSON.parse(raw) as StoredSession) : null);
    } catch {
      setSession(null);
    }
  }, []);

  const generate = useCallback(async () => {
    if (!session || generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: session.scenarioId,
          difficulty: session.difficulty,
          transcript: session.transcript.map((t) => ({
            role: t.role,
            text: t.text,
          })),
          customScenario: session.customScenario ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        report?: Report;
        error?: string;
      };
      if (!res.ok || !data.report) {
        throw new Error(data.error ?? "Could not generate a report.");
      }
      const updated = { ...session, report: data.report };
      setSession(updated);
      try {
        localStorage.setItem("parlay.session", JSON.stringify(updated));
      } catch {
        // ignore
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Report failed.");
    } finally {
      setGenerating(false);
    }
  }, [session, generating]);

  if (session === undefined) {
    return (
      <div className="flex min-h-screen flex-col bg-canvas">
        <SiteHeader />
        <div className="flex flex-1 items-center justify-center text-sm text-ink-subtle">
          Loading report…
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col bg-canvas">
        <SiteHeader />
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-borderline bg-canvas-card text-ink">
            <Icon name="description" className="text-2xl" />
          </div>
          <h1 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-ink">
            No debrief yet
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
            Finish a rehearsal and your coaching report will be saved on this
            device.
          </p>
          <Link
            href={"/" as Route}
            className="mt-6 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#262626]"
          >
            Start a session
          </Link>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const userTurns = session.transcript.filter((t) => t.role === "user").length;
  const duration = Math.max(
    0,
    Math.round((session.endedAt - session.startedAt) / 1000),
  );
  const report = session.report;
  const minutes = String(Math.floor(duration / 60)).padStart(2, "0");
  const seconds = String(duration % 60).padStart(2, "0");

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
        <div className="animate-fade-up">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-borderline bg-canvas-card px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
              Coaching debrief
            </span>
            <span className="text-xs text-ink-subtle">
              {session.scenarioTitle} · {difficultyLabels[session.difficulty]}
            </span>
          </div>

          <h1 className="mt-4 font-display text-3xl font-extrabold leading-[1.1] tracking-tightest text-ink sm:text-[40px]">
            {report ? report.headline : "Session complete"}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-subtle">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="person" className="text-sm" />
              with {session.counterpartName}
            </span>
            <span className="h-1 w-1 rounded-full bg-borderline" />
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
              <Icon name="schedule" className="text-sm" />
              {minutes}:{seconds}
            </span>
            <span className="h-1 w-1 rounded-full bg-borderline" />
            <span>
              {userTurns} {userTurns === 1 ? "answer" : "answers"} from you
            </span>
            {report ? (
              <span
                className={`rounded-full border px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                  VERDICT[report.verdict].className
                }`}
              >
                {VERDICT[report.verdict].label}
              </span>
            ) : null}
          </div>
        </div>

        {!report ? (
          <div className="mt-9 rounded-xl border border-borderline bg-canvas-card p-6 shadow-card">
            {userTurns === 0 ? (
              <p className="text-sm leading-relaxed text-ink-muted">
                There was not enough of your side of the conversation to
                evaluate. Run the scenario again and speak through at least one
                exchange.
              </p>
            ) : (
              <>
                <Label>Report pending</Label>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  The coaching report was not generated for this session. You can
                  try again now — it uses the transcript saved in your browser.
                </p>
                {genError ? (
                  <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                    {genError}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={generate}
                  disabled={generating}
                  className="mt-5 inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#262626] disabled:opacity-50"
                >
                  {generating ? (
                    <>
                      <Icon
                        name="progress_activity"
                        className="animate-spin text-base"
                      />
                      Generating…
                    </>
                  ) : (
                    "Generate report"
                  )}
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="mt-9 overflow-hidden rounded-xl border border-[#E4E3DF] bg-canvas-card shadow-card">
              <div className="flex items-center gap-2 border-b border-borderline-light bg-[#FAFAF8] px-5 py-3">
                <Icon name="summarize" className="text-base text-ink" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink">
                  Overall read
                </span>
              </div>
              <p className="p-5 text-[15px] leading-relaxed text-[#262626]">
                {report.overall}
              </p>
            </div>

            <Section title="What worked" count={report.strengths.length}>
              {report.strengths.map((item, i) => (
                <Card key={i}>
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                      <Icon name="check" className="text-[13px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {item.point}
                      </p>
                      <div className="mt-3">
                        <Evidence>{item.evidence}</Evidence>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </Section>

            <Section
              title="Missed opportunities"
              count={report.missedOpportunities.length}
            >
              {report.missedOpportunities.map((item, i) => (
                <Card key={i}>
                  <p className="text-sm font-medium text-ink">{item.point}</p>
                  <div className="mt-3">
                    <Evidence>{item.evidence}</Evidence>
                  </div>
                  <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
                    <Label>Try instead</Label>
                    <p className="mt-1 text-sm leading-relaxed text-emerald-900">
                      {item.better}
                    </p>
                  </div>
                </Card>
              ))}
            </Section>

            <Section
              title="Answers that needed more"
              count={report.weakAnswers.length}
            >
              {report.weakAnswers.map((item, i) => (
                <Card key={i}>
                  <Evidence>&ldquo;{item.quote}&rdquo;</Evidence>
                  <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                    {item.why}
                  </p>
                  <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
                    <Label>Alternative</Label>
                    <p className="mt-1 text-sm leading-relaxed text-emerald-900">
                      {item.alternative}
                    </p>
                  </div>
                </Card>
              ))}
            </Section>

            <Section
              title="Where they pushed back"
              count={report.pushback.length}
            >
              {report.pushback.map((item, i) => (
                <Card key={i}>
                  <Label>{session.counterpartName}</Label>
                  <div className="mt-2">
                    <Evidence>&ldquo;{item.counterpart}&rdquo;</Evidence>
                  </div>
                  <div className="mt-4">
                    <Label>You</Label>
                    <p className="mt-1 text-sm leading-relaxed text-ink">
                      &ldquo;{item.yourResponse}&rdquo;
                    </p>
                  </div>
                  <p className="mt-3 border-t border-borderline-light pt-3 text-sm leading-relaxed text-ink-muted">
                    {item.assessment}
                  </p>
                </Card>
              ))}
            </Section>

            <Section title="Next attempt" count={report.nextSteps.length}>
              <Card>
                <ol className="space-y-3">
                  {report.nextSteps.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm leading-relaxed">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink text-[10px] font-semibold text-white">
                        {i + 1}
                      </span>
                      <span className="text-[#262626]">{step}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            </Section>
          </>
        )}

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href={
              `/session/${session.scenarioId}?difficulty=${session.difficulty}` as Route
            }
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#262626]"
          >
            <Icon name="replay" className="text-base" />
            Run it again
          </Link>
          <Link
            href={"/" as Route}
            className="rounded-lg border border-borderline bg-canvas-card px-5 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
          >
            Another scenario
          </Link>
        </div>

        {session.transcript.length > 0 ? (
          <details className="group mt-9 rounded-xl border border-borderline bg-canvas-card">
            <summary className="flex cursor-pointer select-none items-center justify-between px-5 py-4 text-sm font-medium text-ink">
              Full transcript ({session.transcript.length} turns)
              <Icon
                name="expand_more"
                className="text-lg text-ink-subtle transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="space-y-4 border-t border-borderline-light px-5 py-5">
              {session.transcript.map((turn, i) => (
                <div key={`${turn.at}-${i}`}>
                  <p
                    className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                      turn.role === "user" ? "text-ink" : "text-ink-subtle"
                    }`}
                  >
                    {turn.role === "user" ? "You" : session.counterpartName}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                    {turn.text}
                  </p>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        <p className="mt-8 border-t border-borderline-light pt-4 text-[11px] leading-relaxed text-ink-subtle">
          This report reflects the transcript above and is a coaching aid, not a
          prediction of how the real conversation will go. Sessions are stored
          only in this browser.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
