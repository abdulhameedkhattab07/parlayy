"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { saveCustomScenario } from "@/lib/custom-scenario";
import type { CustomScenario, Difficulty } from "@/lib/types";

const PRESETS = [
  {
    label: "Negotiate a fee",
    prompt:
      "I am negotiating an annual contract renewal with an enterprise client asking for an unprompted 25% discount to stay.",
  },
  {
    label: "Pitch an institutional investor",
    prompt:
      "I am pitching our Series A lead investor who is deeply skeptical of our gross margin sustainability in competitive markets.",
  },
  {
    label: "Executive interview",
    prompt:
      "I am interviewing for a Chief Product Officer position and need to articulate why I left my last firm after an executive leadership restructure.",
  },
  {
    label: "Difficult board confrontation",
    prompt:
      "I need to address our board regarding a delayed Q3 product release and present an alternative capital allocation timeline.",
  },
];

const PERSONAS = [
  "Rational Skeptic",
  "Impatient Executive",
  "Warm Collaborator",
  "Hard Negotiator",
];

const RIGOR_LABELS: Record<number, string> = {
  1: "Exploratory tone",
  2: "Balanced rigor",
  3: "High pushback",
};

const RIGOR_DIFFICULTY: Record<number, Difficulty> = {
  1: "easy",
  2: "medium",
  3: "hard",
};

const DEFAULT_BRIEF =
  "I have a meeting with a client tomorrow. They think my price is too high, and I need to defend my value without losing the deal.";

export function ScenarioPicker() {
  const router = useRouter();
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [rigor, setRigor] = useState(2);
  const [persona, setPersona] = useState(PERSONAS[0]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(Math.max(el.scrollHeight, 104), 240)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [brief]);

  async function begin() {
    if (generating) return;
    const text = brief.trim();
    if (text.length < 10) {
      setError("Describe the conversation in a little more detail.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/scenario", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief: `${text}\n\nCounterpart posture: ${persona}.`, rigor }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        customScenario?: CustomScenario;
        error?: string;
      };
      if (!res.ok || !data.customScenario) {
        throw new Error(data.error ?? "Could not generate the scenario.");
      }
      saveCustomScenario(data.customScenario);
      router.push(
        `/session/${data.customScenario.scenario.id}?difficulty=${RIGOR_DIFFICULTY[rigor]}` as Route,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not generate the scenario.",
      );
      setGenerating(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="flex w-full flex-1 flex-col items-center">
        <section className="mx-auto flex w-full max-w-[1240px] flex-col items-center px-4 pb-16 pt-12 sm:px-8 sm:pt-20">
          <div className="mb-10 flex max-w-3xl flex-col items-center text-center sm:mb-12">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-borderline bg-canvas-alt px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-ink-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-ink" />
              Autonomous Voice Sparring
            </div>
            <h1 className="mb-5 text-center font-display text-4xl font-extrabold leading-[1.08] tracking-[-0.035em] text-ink sm:text-6xl md:text-[64px]">
              Get ready for the conversations{" "}
              <br className="hidden sm:inline" />
              <span className="font-bold text-ink-muted">
                that actually matter.
              </span>
            </h1>
            <p className="max-w-xl text-center text-base font-normal leading-relaxed text-ink-muted sm:text-lg">
              Describe the situation. Parlayy adopts the counterpart&apos;s
              persona, anticipates friction, and pressure-tests your composure
              before your reputation is on the line.
            </p>
          </div>

          <div className="relative z-10 w-full max-w-[760px]">
            <div className="overflow-hidden rounded-2xl border border-borderline/90 bg-white shadow-[0_4px_30px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.02)] transition-all duration-200">
              <div className="flex items-center justify-between gap-3 border-b border-borderline-light bg-[#FAF9F7] px-4 py-4 sm:px-6">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-ink/10 bg-ink/5 px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-wider text-ink">
                    <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                    Scenario Specification
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] font-medium text-ink-subtle">
                  <span className="hidden font-mono text-[11px] text-ink-subtle sm:inline">
                    {brief.length} chars
                  </span>
                  <span className="hidden text-borderline sm:inline">•</span>
                  <div className="flex items-center gap-1.5 rounded-md border border-borderline bg-white px-2.5 py-1 text-ink-muted">
                    <Icon
                      name="verified_user"
                      className="text-[13px] text-emerald-600"
                    />
                    <span className="hidden text-[11px] font-medium tracking-tight sm:inline">
                      Zero-retention protocol
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white p-4 pb-5 sm:p-6 sm:pb-5">
                <label className="sr-only" htmlFor="prompt-input">
                  Conversation Details
                </label>
                <textarea
                  id="prompt-input"
                  ref={textareaRef}
                  rows={3}
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  placeholder="Describe your counterpart, their posture, and what is on the line..."
                  className="max-h-[240px] min-h-[104px] w-full resize-none overflow-y-auto border-none bg-transparent p-0 font-display text-[17px] font-medium leading-[1.6] tracking-[-0.015em] text-ink outline-none placeholder:text-ink-subtle focus:ring-0 selection:bg-ink selection:text-canvas sm:text-[19px]"
                />
              </div>

              <div className="flex flex-col items-stretch justify-between gap-4 border-t border-borderline-light bg-[#FAF9F7] px-4 py-4 sm:flex-row sm:items-end sm:px-6">
                <div className="flex w-full flex-col gap-1.5 sm:w-auto">
                  <label
                    htmlFor="persona-select"
                    className="text-[10px] font-semibold uppercase tracking-widest text-ink-subtle"
                  >
                    Persona
                  </label>
                  <div className="relative">
                    <select
                      id="persona-select"
                      value={persona}
                      onChange={(event) => setPersona(event.target.value)}
                      className="w-full appearance-none rounded-lg border border-borderline bg-white py-2 pl-3 pr-9 text-[12px] font-medium text-ink outline-none transition-colors hover:border-ink/30 focus:border-ink/60 sm:w-[184px]"
                    >
                      {PERSONAS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <Icon
                      name="expand_more"
                      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-ink-muted"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-subtle">
                      Rigor
                    </span>
                    <div className="flex items-center gap-1 rounded-lg border border-borderline bg-white p-1">
                      {[1, 2, 3].map((step) => (
                        <button
                          key={step}
                          type="button"
                          onClick={() => setRigor(step)}
                          aria-label={`Rigor ${step}: ${RIGOR_LABELS[step]}`}
                          className={`flex h-7 w-7 items-center justify-center rounded text-[11px] font-medium transition-colors sm:h-6 sm:w-6 ${
                            rigor === step
                              ? "bg-ink text-canvas"
                              : "text-ink-muted hover:text-ink"
                          }`}
                        >
                          {step}
                        </button>
                      ))}
                    </div>
                    <span className="hidden whitespace-nowrap text-[11px] font-medium text-ink-muted sm:inline">
                      {RIGOR_LABELS[rigor]}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={begin}
                    disabled={generating}
                    aria-label={
                      generating ? "Calibrating scenario" : "Begin rehearsal"
                    }
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-ink text-canvas shadow-sm transition-all hover:bg-[#262626] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3.5 sm:py-2"
                  >
                    <Icon
                      name={generating ? "progress_activity" : "mic"}
                      className={`text-[18px] sm:text-[15px] ${generating ? "animate-spin" : ""}`}
                    />
                    <span className="hidden text-xs font-semibold sm:inline">
                      {generating ? "Calibrating…" : "Begin Rehearsal"}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {error ? (
              <p className="mt-3 rounded-lg border border-rec/30 bg-rec/5 px-3 py-2 text-center text-xs text-rec">
                {error}
              </p>
            ) : null}

            <div className="mt-8 flex flex-col items-center">
              <span className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-ink-subtle">
                Pre-calibrated scenarios
              </span>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setBrief(preset.prompt)}
                    className="rounded-full border border-borderline bg-canvas-card px-4 py-2 font-display text-[13px] font-semibold text-ink-muted shadow-2xs transition-all hover:border-ink/50 hover:text-ink"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div
            id="how-it-works"
            className="mt-24 w-full max-w-[1040px] border-t border-borderline pt-16"
          >
            <div className="mb-10 flex flex-col justify-between gap-2 sm:flex-row sm:items-baseline">
              <div>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-ink-subtle">
                  Methodology
                </span>
                <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
                  Engineered for executive stakes
                </h2>
              </div>
              <span className="text-[12px] font-normal text-ink-muted">
                Powered by Gradium
              </span>
            </div>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-10">
              {[
                {
                  num: "01 / CALIBRATION",
                  title: "Pushback Calibration",
                  body: "Unlike generic assistants, Parlayy will not appease or flatter. Counterparts will interrupt tactically, resist concessions, and exploit logical inconsistencies.",
                },
                {
                  num: "02 / PHYSIOLOGY",
                  title: "Physiological Desensitization",
                  body: "Spoken, natural voice sparring conditions your vagal response. You practice holding strategic silence, controlling inflection, and remaining grounded under direct skepticism.",
                },
                {
                  num: "03 / DIAGNOSTIC",
                  title: "Voice & Transcript Debrief",
                  body: "Every round produces an actionable executive brief: premature concessions highlighted, filler density catalogued, and alternative rhetorical framings prescribed.",
                },
              ].map((item) => (
                <div
                  key={item.num}
                  className="flex flex-col border-t-2 border-ink pt-5"
                >
                  <span className="mb-3 font-mono text-[12px] font-medium text-ink-subtle">
                    {item.num}
                  </span>
                  <h3 className="mb-2.5 font-display text-xl font-bold tracking-tight text-ink">
                    {item.title}
                  </h3>
                  <p className="text-[14px] font-normal leading-relaxed text-ink-muted">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter variant="home" />
    </>
  );
}
