"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  openSttSession,
  speak,
  SpeechPlayer,
  type SpeakHandle,
  type SttHandlers,
  type SttSession,
} from "@/lib/voice/gradium";
import { startMicrophone, type MicHandle } from "@/lib/voice/mic";
import type {
  CoachReport,
  CustomScenario,
  Difficulty,
  PublicScenario,
  StoredSession,
  Turn,
} from "@/lib/types";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { SiteFooter } from "./SiteFooter";

type Phase =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "ended"
  | "error";

const VAD_THRESHOLD = 0.6;
const TURN_SILENCE_MS = 1000;
const MIN_TURN_CHARS = 2;
const POST_SPEECH_GUARD_MS = 250;
const CHAT_HISTORY_LIMIT = 16;

const DIFFICULTY_TIER: Record<Difficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

function saveSession(session: StoredSession) {
  try {
    localStorage.setItem("parlay.session", JSON.stringify(session));
    const raw = localStorage.getItem("parlay.history");
    const history = raw ? (JSON.parse(raw) as StoredSession[]) : [];
    const next = [session, ...history.filter((s) => s.id !== session.id)].slice(
      0,
      20,
    );
    localStorage.setItem("parlay.history", JSON.stringify(next));
  } catch {
    // storage may be unavailable; report still renders from memory on this page
  }
}

function timeLabel(at: number): string {
  try {
    return new Date(at).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function ChatMessage({
  role,
  name,
  text,
  at,
  speaking,
  flagged,
  live,
}: {
  role: "user" | "counterpart";
  name: string;
  text: string;
  at: number;
  speaking?: boolean;
  flagged?: boolean;
  live?: boolean;
}) {
  return (
    <div className="animate-fade-up py-2">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="text-[14px] font-bold tracking-tight text-[#121212]">
          {role === "user" ? "You" : name}
        </span>
        <span className="text-[11px] text-[#8C8C8C]">
          {live ? "Just now" : timeLabel(at)}
        </span>
        {speaking ? (
          <span className="ml-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" />
            Speaking
          </span>
        ) : null}
        {flagged ? (
          <span className="inline-flex items-center gap-1 rounded border border-[#E0E0E0] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#525252]">
            <Icon name="bookmark" className="text-[11px]" />
            Flagged
          </span>
        ) : null}
      </div>
      <div
        className={`break-words text-[14px] leading-relaxed ${
          live ? "text-[#737373]" : "text-[#262626]"
        }`}
      >
        {text}
        {speaking || live ? <span className="stream-cursor" /> : null}
      </div>
    </div>
  );
}

export function SessionClient({
  scenario,
  difficulty,
  customScenario,
}: {
  scenario: PublicScenario;
  difficulty: Difficulty;
  customScenario?: CustomScenario | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [speakLevel, setSpeakLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [useText, setUseText] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [coach, setCoach] = useState<CoachReport | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [flags, setFlags] = useState<number[]>([]);
  const [endOpen, setEndOpen] = useState(false);

  const playerRef = useRef<SpeechPlayer | null>(null);
  const micRef = useRef<MicHandle | null>(null);
  const sttRef = useRef<SttSession | null>(null);
  const speakHandleRef = useRef<SpeakHandle | null>(null);
  const acceptingRef = useRef(false);
  const processingRef = useRef(false);
  const userBufferRef = useRef("");
  const transcriptRef = useRef<Turn[]>([]);
  const silenceTimerRef = useRef<number | null>(null);
  const sttGenRef = useRef(0);
  const flushIdRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  const mutedRef = useRef(false);
  const endedRef = useRef(false);
  const interceptHeldRef = useRef(false);
  const interceptQueuedRef = useRef(false);
  const coachReqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (phase === "idle" || phase === "ended" || phase === "error") return;
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, interim]);

  useEffect(() => {
    return () => {
      teardown();
    };
  }, []);

  function teardown() {
    acceptingRef.current = false;
    sttGenRef.current += 1;
    try {
      speakHandleRef.current?.stop();
    } catch {
      // ignore
    }
    speakHandleRef.current = null;
    try {
      sttRef.current?.close();
    } catch {
      // ignore
    }
    sttRef.current = null;
    try {
      micRef.current?.stop();
    } catch {
      // ignore
    }
    micRef.current = null;
    try {
      playerRef.current?.stop();
    } catch {
      // ignore
    }
    playerRef.current = null;
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  function pushTurn(turn: Turn) {
    transcriptRef.current = [...transcriptRef.current, turn];
    setTranscript(transcriptRef.current);
  }

  function clearFlushTimer() {
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  async function refreshCoach() {
    const turns = transcriptRef.current.filter((t) => t.role === "user");
    if (turns.length === 0 || endedRef.current) return;
    const req = ++coachReqRef.current;
    setCoachLoading(true);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: scenario.id,
          difficulty,
          transcript: transcriptRef.current.map((t) => ({
            role: t.role,
            text: t.text,
          })),
          customScenario: customScenario ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        coach?: CoachReport;
        error?: string;
      };
      if (req !== coachReqRef.current) return;
      if (res.ok && data.coach) {
        setCoach(data.coach);
        setCoachError(null);
      } else {
        setCoachError(data.error ?? "Telemetry unavailable.");
      }
    } catch {
      if (req === coachReqRef.current) {
        setCoachError("Telemetry unavailable.");
      }
    } finally {
      if (req === coachReqRef.current) setCoachLoading(false);
    }
  }

  async function respond() {
    if (endedRef.current) return;
    acceptingRef.current = false;
    setPhase("thinking");
    const history = transcriptRef.current.slice(-CHAT_HISTORY_LIMIT);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: scenario.id,
          difficulty,
          transcript: history.map((t) => ({ role: t.role, text: t.text })),
          customScenario: customScenario ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
      };
      if (!res.ok || !data.reply) {
        throw new Error(data.error ?? "The counterpart is unavailable.");
      }
      if (endedRef.current) return;
      pushTurn({ role: "counterpart", text: data.reply, at: Date.now() });
      void refreshCoach();

      const player = playerRef.current;
      if (!player) return;
      setPhase("speaking");
      const handle = await speak(data.reply, scenario.voice.id, player);
      speakHandleRef.current = handle;
      await handle.done;
      speakHandleRef.current = null;
      if (endedRef.current) return;
      await new Promise((resolve) =>
        window.setTimeout(resolve, POST_SPEECH_GUARD_MS),
      );
      if (endedRef.current) return;
      clearSilenceTimer();
      if (micRef.current && !sttRef.current) {
        await connectStt();
      }
      if (endedRef.current) return;
      processingRef.current = false;
      acceptingRef.current = !mutedRef.current;
      setPhase("listening");
      setNotice(null);
      if (interceptQueuedRef.current && !interceptHeldRef.current) {
        interceptQueuedRef.current = false;
        startTurn();
      }
    } catch (err) {
      processingRef.current = false;
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  function commitUserTurn() {
    clearFlushTimer();
    clearSilenceTimer();
    const text = userBufferRef.current.trim();
    userBufferRef.current = "";
    setInterim("");

    if (!text) {
      processingRef.current = false;
      if (endedRef.current) return;
      acceptingRef.current = !mutedRef.current;
      setPhase(micRef.current ? "listening" : "idle");
      return;
    }
    pushTurn({ role: "user", text, at: Date.now() });
    void respond();
  }

  function startTurn(fromText = false) {
    if (processingRef.current || endedRef.current) return;
    if (!fromText && !acceptingRef.current) return;
    processingRef.current = true;
    acceptingRef.current = false;
    setPhase("thinking");
    const id = ++flushIdRef.current;
    clearFlushTimer();
    clearSilenceTimer();
    flushTimerRef.current = window.setTimeout(() => commitUserTurn(), 2500);
    if (sttRef.current && !fromText) {
      sttRef.current.flush(id);
    } else {
      commitUserTurn();
    }
  }

  function sttOptions() {
    return {
      language: "en",
      delayInFrames: 16,
      sampleRate: micRef.current?.sampleRate,
    };
  }

  function makeSttHandlers(gen: number): SttHandlers {
    return {
      onText: (text) => {
        userBufferRef.current = `${userBufferRef.current} ${text}`
          .replace(/\s+/g, " ")
          .trimStart();
        setInterim(userBufferRef.current);
        clearSilenceTimer();
      },
      onInactivity: (probability) => {
        if (!acceptingRef.current || processingRef.current) {
          clearSilenceTimer();
          return;
        }
        if (userBufferRef.current.trim().length < MIN_TURN_CHARS) {
          clearSilenceTimer();
          return;
        }
        if (probability > VAD_THRESHOLD) {
          if (silenceTimerRef.current === null) {
            silenceTimerRef.current = window.setTimeout(() => {
              silenceTimerRef.current = null;
              if (!acceptingRef.current || processingRef.current) return;
              if (userBufferRef.current.trim().length < MIN_TURN_CHARS) return;
              startTurn();
            }, TURN_SILENCE_MS);
          }
        } else {
          clearSilenceTimer();
        }
      },
      onFlushed: () => commitUserTurn(),
      onError: (message) => {
        if (gen !== sttGenRef.current) return;
        setError(message);
        setPhase("error");
      },
      onClose: () => {
        if (gen !== sttGenRef.current) return;
        sttRef.current = null;
        if (endedRef.current || processingRef.current) return;
        if (!micRef.current) return;
        setNotice("Voice connection dropped — reconnecting…");
        window.setTimeout(() => {
          void connectStt();
        }, 500);
      },
    };
  }

  async function connectStt() {
    if (endedRef.current || sttRef.current) return;
    const gen = ++sttGenRef.current;
    try {
      const stt = await openSttSession(makeSttHandlers(gen), sttOptions());
      if (gen !== sttGenRef.current) {
        stt.close();
        return;
      }
      sttRef.current = stt;
      setNotice(null);
    } catch (err) {
      if (gen !== sttGenRef.current) return;
      setNotice(
        err instanceof Error
          ? `Voice input unavailable: ${err.message}`
          : "Voice input unavailable.",
      );
    }
  }

  async function begin(options: { text?: boolean } = {}) {
    const textMode = options.text ?? useText;
    if (options.text) setUseText(true);
    teardown();
    endedRef.current = false;
    processingRef.current = false;
    interceptHeldRef.current = false;
    interceptQueuedRef.current = false;
    userBufferRef.current = "";
    transcriptRef.current = [];
    setTranscript([]);
    setInterim("");
    setError(null);
    setNotice(null);
    setElapsed(0);
    setCoach(null);
    setCoachError(null);
    setFlags([]);
    setPhase("connecting");

    try {
      const player = new SpeechPlayer();
      playerRef.current = player;
      player.onLevel = (level) => setSpeakLevel(level);
      await player.resume();

      let micAvailable = false;
      if (!textMode) {
        try {
          const mic = await startMicrophone(
            (samples) => {
              if (!acceptingRef.current || mutedRef.current) return;
              sttRef.current?.sendAudio(samples);
            },
            (level) => setMicLevel(level),
          );
          micRef.current = mic;
          micAvailable = true;
        } catch {
          setUseText(true);
          setNotice(
            "Microphone unavailable. Type your side of the conversation and the counterpart will still speak.",
          );
        }
      }

      if (micAvailable) {
        await connectStt();
      }

      acceptingRef.current = micAvailable && !mutedRef.current;
      setPhase("listening");
      await respond();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start the session.",
      );
      setPhase("error");
    }
  }

  function submitText() {
    const value = textInput.trim();
    if (!value) return;
    userBufferRef.current = value;
    setTextInput("");
    startTurn(true);
  }

  async function endSession() {
    if (endedRef.current) return;
    setEndOpen(false);
    endedRef.current = true;
    interceptHeldRef.current = false;
    interceptQueuedRef.current = false;
    acceptingRef.current = false;
    setPhase("ended");

    const finalTranscript = [...transcriptRef.current];
    const pending = userBufferRef.current.trim();
    if (pending) {
      finalTranscript.push({ role: "user", text: pending, at: Date.now() });
    }

    teardown();

    const session: StoredSession = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Date.now()),
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      counterpartName: scenario.counterpart.name,
      difficulty,
      startedAt: Date.now() - elapsed * 1000,
      endedAt: Date.now(),
      transcript: finalTranscript,
      report: null,
      customScenario: customScenario ?? null,
    };
    saveSession(session);

    if (finalTranscript.some((t) => t.role === "user")) {
      try {
        const res = await fetch("/api/evaluate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scenarioId: scenario.id,
            difficulty,
            transcript: finalTranscript.map((t) => ({
              role: t.role,
              text: t.text,
            })),
            customScenario: customScenario ?? undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          report?: StoredSession["report"];
        };
        if (res.ok && data.report) {
          session.report = data.report;
          saveSession(session);
        }
      } catch {
        // leave report null; report page will explain
      }
    }

    router.push("/report" as Route);
  }

  function toggleFlag() {
    const index = transcriptRef.current.length - 1;
    if (index < 0) return;
    setFlags((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index],
    );
  }

  function onInterceptDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (endedRef.current) return;
    if (phase !== "speaking") return;
    interceptHeldRef.current = true;
    interceptQueuedRef.current = true;
    speakHandleRef.current?.stop();
  }

  function onInterceptUp() {
    interceptHeldRef.current = false;
    if (endedRef.current || mutedRef.current) return;
    if (interceptQueuedRef.current && acceptingRef.current) {
      interceptQueuedRef.current = false;
      startTurn();
      return;
    }
    if (phase === "listening") {
      startTurn();
    }
  }

  const active =
    phase === "listening" || phase === "speaking" || phase === "thinking";
  const tier = DIFFICULTY_TIER[difficulty];
  const lastFlag = transcript.length - 1;
  const flagged = lastFlag >= 0 && flags.includes(lastFlag);

  const status =
    phase === "speaking" || phase === "listening"
      ? {
          label: phase === "speaking" ? "Speaking" : "Listening",
          className:
            "text-emerald-700 bg-emerald-50 border-emerald-200",
          dot: "bg-emerald-600",
        }
      : phase === "thinking" || phase === "connecting"
        ? {
            label: phase === "connecting" ? "Connecting" : "Thinking",
            className: "text-amber-700 bg-amber-50 border-amber-200",
            dot: "bg-amber-500",
          }
        : {
            label: "Standby",
            className: "text-[#737373] bg-[#F5F5F5] border-[#E5E5E5]",
            dot: "bg-[#A3A3A3]",
          };

  const micLabel = muted
    ? "Mic Muted"
    : phase === "connecting"
      ? "Connecting"
      : phase === "thinking"
        ? "Thinking"
        : phase === "speaking"
          ? "Counterpart Speaking"
          : "Microphone Active";

  const micHint = useText
    ? "Type your side of the conversation"
    : muted
      ? "Unmute to speak"
      : phase === "listening"
        ? "Speak naturally, or hold Intercept to cut in"
        : "Listen, then respond";

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const exchanges = transcript.filter((t) => t.role === "user").length;
  const level = phase === "speaking" ? speakLevel : micLevel;

  const leverage = coach?.leverage ?? 0;
  const talkYou = coach?.talkListenYou ?? 0;
  const talkThem = coach?.talkListenThem ?? 100;
  const assertiveness = coach?.assertiveness ?? 0;
  const solved = coach?.objectionsSolved ?? 0;
  const total = coach?.objectionsTotal ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAFA] text-[#121212] selection:bg-[#121212] selection:text-white">
      <header className="sticky top-0 z-40 w-full border-b border-[#EDEDED] bg-white">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex flex-shrink-0 items-center gap-3.5">
            <Link
              href={"/" as Route}
              className="flex items-center gap-2 whitespace-nowrap font-display text-[20px] font-extrabold tracking-tight text-[#121212] transition-opacity hover:opacity-85"
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#121212]" />
              Parlay
            </Link>
            <div className="hidden h-4 w-px bg-[#E5E5E5] sm:block" />
            <div className="hidden items-center gap-2 whitespace-nowrap rounded-full bg-[#F4F4F4] px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-[#262626] sm:flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
              </span>
              Live Sparring
            </div>
          </div>

          <div className="hidden min-w-0 max-w-xl flex-col items-center justify-center px-2 text-center md:flex">
            <div className="flex max-w-full items-center gap-2">
              <h1 className="truncate text-sm font-semibold text-[#121212]">
                {scenario.title}
              </h1>
              <span className="whitespace-nowrap rounded bg-[#EFEFEF] px-2 py-0.5 text-xs font-medium text-[#404040]">
                Tier {tier} Rigor
              </span>
            </div>
            <p className="mt-0.5 w-full truncate text-xs text-[#737373]">
              Opponent: {scenario.counterpart.name} (
              {scenario.counterpart.role}) • {scenario.category}
            </p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2.5">
            <div className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#E5E5E5] bg-[#F5F5F5] px-2.5 py-1.5 text-xs font-medium text-[#262626]">
              <Icon name="schedule" className="text-sm text-[#737373]" />
              <span className="font-mono font-semibold tabular-nums text-[#121212]">
                {mm}:{ss}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                muted
                  ? "border-red-200 bg-red-50 text-red-600"
                  : "border-[#E0E0E0] bg-white text-[#171717] hover:bg-[#F5F5F5]"
              }`}
            >
              <Icon
                name={muted ? "mic_off" : "mic"}
                className="text-[17px]"
              />
              <span className="hidden sm:inline">
                {muted ? "Unmute" : "Mute Mic"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setEndOpen(true)}
              className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#121212] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#262626]"
            >
              <Icon name="stop_circle" className="text-[17px] text-red-400" />
              <span>End &amp; Debrief</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid min-h-0 w-full max-w-[1440px] flex-1 grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-12">
        <section className="flex h-[72vh] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white shadow-sm lg:col-span-8 lg:h-[calc(100vh-170px)]">
          <div className="flex items-center justify-between border-b border-[#F0F0F0] bg-white/90 px-5 py-3 backdrop-blur-sm">
            <div className="flex min-w-0 items-center gap-2.5">
              <Icon name="forum" className="text-base text-[#525252]" />
              <div className="flex min-w-0 items-center gap-2">
                <span className="whitespace-nowrap text-xs font-bold uppercase tracking-wider text-[#171717]">
                  Direct Audio Channel
                </span>
                <span className="text-[#D4D4D4]">•</span>
                <span className="truncate text-xs text-[#737373]">
                  Voice-to-Text Transcription (Gradium)
                </span>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  active ? "animate-pulse bg-emerald-500" : "bg-[#D4D4D4]"
                }`}
              />
              <span className="whitespace-nowrap text-[11px] font-medium text-[#737373]">
                Full Duplex Audio Stream
              </span>
            </div>
          </div>

          {phase === "idle" ? (
            <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
              <div className="w-full max-w-md text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#121212] text-white shadow-md">
                  <Icon name="graphic_eq" className="text-2xl" />
                </div>
                <h2 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-[#121212]">
                  {scenario.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[#737373]">
                  {scenario.briefing.situation}
                </p>
                <div className="mt-5 rounded-xl border border-[#E8E8E8] bg-[#FAFAFA] p-3.5 text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A3A3A3]">
                    Your goal
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-[#262626]">
                    {scenario.briefing.yourGoal}
                  </p>
                </div>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => begin()}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#121212] px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#262626] active:scale-[0.98]"
                  >
                    <Icon name="mic" className="text-[16px]" />
                    Start rehearsal
                  </button>
                  <button
                    type="button"
                    onClick={() => begin({ text: true })}
                    className="rounded-lg border border-[#E0E0E0] bg-white px-4 py-2.5 text-xs font-medium text-[#262626] transition-colors hover:bg-[#F5F5F5]"
                  >
                    Type instead
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-[#A3A3A3]">
                  Headphones give the cleanest turn-taking.
                </p>
              </div>
            </div>
          ) : phase === "error" ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="w-full max-w-md text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <Icon name="error" className="text-2xl" />
                </div>
                <h2 className="mt-4 font-display text-xl font-bold text-[#121212]">
                  Session interrupted
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[#737373]">
                  {error ?? "Something went wrong."}
                </p>
                <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => begin()}
                    className="rounded-lg bg-[#121212] px-4 py-2.5 text-xs font-semibold text-white"
                  >
                    Try again
                  </button>
                  <Link
                    href={"/" as Route}
                    className="rounded-lg border border-[#E0E0E0] bg-white px-4 py-2.5 text-xs font-medium text-[#262626]"
                  >
                    Back to scenarios
                  </Link>
                </div>
              </div>
            </div>
          ) : phase === "connecting" || phase === "ended" ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <div>
                <Icon
                  name="progress_activity"
                  className="animate-spin text-3xl text-[#737373]"
                />
                <p className="mt-3 text-sm text-[#737373]">
                  {phase === "ended"
                    ? "Preparing your debrief…"
                    : "Connecting your microphone and voice link…"}
                </p>
              </div>
            </div>
          ) : (
            <div
              ref={scrollRef}
              className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6"
            >
              {notice ? (
                <p className="rounded-lg border border-[#E8E8E8] bg-[#FAFAFA] px-3 py-2 text-[11px] leading-relaxed text-[#737373]">
                  {notice}
                </p>
              ) : null}
              <div className="relative my-2 flex items-center justify-center">
                <div className="w-full border-t border-[#EDEDED]" />
                <span className="absolute bg-white px-3 text-[11px] font-semibold uppercase tracking-wider text-[#A3A3A3]">
                  Rehearsal Started • Today
                </span>
              </div>

              {transcript.map((turn, index) => (
                <ChatMessage
                  key={`${turn.at}-${index}`}
                  role={turn.role}
                  name={scenario.counterpart.name}
                  text={turn.text}
                  at={turn.at}
                  flagged={flags.includes(index)}
                  speaking={
                    phase === "speaking" &&
                    turn.role === "counterpart" &&
                    index === transcript.length - 1
                  }
                />
              ))}

              {interim ? (
                <ChatMessage
                  role="user"
                  name={scenario.counterpart.name}
                  text={interim}
                  at={Date.now()}
                  live
                />
              ) : null}
            </div>
          )}

          <div className="border-t border-[#EDEDED] bg-white p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E5E5E5] bg-[#F7F7F7] p-2 shadow-inner sm:p-2.5">
              {useText && phase !== "idle" ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
                  <input
                    value={textInput}
                    onChange={(event) => setTextInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submitText();
                      }
                    }}
                    placeholder="Type your side…"
                    disabled={phase !== "listening"}
                    className="min-w-0 flex-1 rounded-md border border-[#E5E5E5] bg-white px-3 py-2 text-sm text-[#121212] outline-none placeholder:text-[#A3A3A3] focus:border-[#121212]/40 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={submitText}
                    disabled={phase !== "listening"}
                    className="rounded-md border border-[#E0E0E0] bg-white px-3 py-2 text-xs font-medium text-[#262626] disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              ) : (
                <div className="flex min-w-0 items-center gap-3 pl-2">
                  <div
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border ${
                      muted
                        ? "border-red-200 bg-red-50"
                        : "border-emerald-300 bg-emerald-100"
                    }`}
                  >
                    <Icon
                      name={muted ? "mic_off" : "mic"}
                      className={`text-base ${
                        muted ? "text-red-600" : "text-emerald-700"
                      } ${phase === "listening" ? "animate-pulse" : ""}`}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="whitespace-nowrap text-xs font-bold text-[#121212]">
                        {micLabel}
                      </span>
                      <span className="whitespace-nowrap rounded border border-[#E0E0E0] bg-white px-1.5 py-0.5 font-mono text-[10px] text-[#525252]">
                        Gradium ASR
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-[#737373]">
                      {micHint}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={toggleFlag}
                  disabled={lastFlag < 0}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                    flagged
                      ? "border-[#121212] bg-[#121212] text-white"
                      : "border-[#E0E0E0] bg-white text-[#262626] hover:bg-[#F0F0F0]"
                  }`}
                >
                  <Icon name="bookmark" className="text-sm" />
                  <span className="hidden md:inline">
                    {flagged ? "Flagged" : "Flag Moment"}
                  </span>
                </button>
                <button
                  type="button"
                  onPointerDown={onInterceptDown}
                  onPointerUp={onInterceptUp}
                  onPointerCancel={onInterceptUp}
                  disabled={phase === "idle" || phase === "error" || phase === "ended"}
                  className="flex touch-none select-none items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#121212] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#262626] active:scale-95 disabled:opacity-40"
                >
                  <Icon name="front_hand" className="text-sm" />
                  <span>Hold to Intercept</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="flex flex-col gap-5 lg:col-span-4">
          <div className="relative flex flex-col items-center overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white p-5 text-center shadow-sm">
            <div className="mb-3 flex w-full items-center justify-between text-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#737373]">
                Live Voice Link
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium ${status.className}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${status.dot} ${
                    active ? "animate-ping" : ""
                  }`}
                />
                {status.label}
              </span>
            </div>

            <div className="relative my-3 flex items-center justify-center">
              <div className="z-10 flex h-20 w-20 select-none items-center justify-center rounded-full bg-[#171717] text-2xl font-bold text-white shadow-md">
                {scenario.counterpart.initials}
              </div>
              {phase === "speaking" ? (
                <>
                  <div className="absolute inset-0 scale-125 animate-pulse rounded-full bg-[#121212]/10" />
                  <div className="absolute inset-0 scale-150 rounded-full bg-[#121212]/5" />
                </>
              ) : null}
            </div>
            <h2 className="mt-1 text-base font-bold text-[#121212]">
              {scenario.counterpart.name}
            </h2>
            <p className="mt-0.5 text-xs text-[#737373]">
              {scenario.counterpart.role} • {scenario.counterpart.accentLabel}
            </p>

            <div className="mt-4 flex w-full flex-col items-center gap-2 rounded-xl border border-[#EEEEEE] bg-[#FAFAFA] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#A3A3A3]">
                Counterpart Voice Pitch &amp; Modulation
              </div>
              <div className="flex h-8 w-full items-center justify-center gap-1.5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-1 rounded-full ${
                      phase === "speaking"
                        ? "wave-bar bg-[#121212]"
                        : "bg-[#D4D4D4]"
                    }`}
                    style={
                      phase === "speaking"
                        ? undefined
                        : { height: `${8 + ((i % 4) + 1) * 2}px` }
                    }
                  />
                ))}
              </div>
              <div className="flex w-full items-center justify-between border-t border-[#F0F0F0] pt-1 text-[11px] text-[#737373]">
                <span className="truncate">Tone: {scenario.counterpart.accentLabel}</span>
                <span className="font-mono">{Math.round(level * 100)}%</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-[#E5E5E5] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="lightbulb" className="text-lg text-[#121212]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#121212]">
                  Sparring Intelligence
                </span>
              </div>
              <span className="whitespace-nowrap rounded bg-[#EAEAEA] px-2 py-0.5 text-[10px] font-semibold text-[#262626]">
                Instant Hint
              </span>
            </div>

            <div className="flex flex-col gap-1.5 rounded-xl border border-[#E8E8E8] bg-[#F8F8F8] p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#121212]">
                <Icon name="bolt" className="text-sm" />
                Suggested Counter-Pivot
              </div>
              <p
                className={`text-xs leading-relaxed text-[#333333] ${
                  coachLoading && !coach ? "animate-pulse text-[#8A8A8A]" : ""
                }`}
              >
                {coach?.hint ??
                  (coachLoading
                    ? "Reading the exchange…"
                    : "Start speaking and a live counter-pivot will appear here.")}
              </p>
              {coachError ? (
                <p className="text-[10px] text-red-600">{coachError}</p>
              ) : null}
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-[#737373]">Leverage Balance</span>
                  <span className="font-semibold text-[#121212]">
                    {leverage}% {leverage >= 50 ? "Your Advantage" : "Their Advantage"}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#EEEEEE]">
                  <div
                    className="h-full rounded-full bg-[#121212] transition-all duration-500"
                    style={{ width: `${leverage}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-[#737373]">Talk-to-Listen Ratio</span>
                  <span className="font-semibold text-[#121212]">
                    {talkYou}% You / {talkThem}% {scenario.counterpart.name.split(" ")[0]}
                  </span>
                </div>
                <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[#EEEEEE]">
                  <div
                    className="h-full bg-[#121212]"
                    style={{ width: `${talkYou}%` }}
                  />
                  <div
                    className="h-full bg-[#B0B0B0]"
                    style={{ width: `${talkThem}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-[#F0F0F0] pt-2">
              <div className="flex flex-col rounded-lg border border-[#EAEAEA] bg-[#FAFAFA] p-2.5">
                <span className="text-[11px] text-[#737373]">Assertiveness</span>
                <span className="mt-0.5 text-sm font-bold text-[#121212]">
                  {assertiveness} / 100
                </span>
              </div>
              <div className="flex flex-col rounded-lg border border-[#EAEAEA] bg-[#FAFAFA] p-2.5">
                <span className="text-[11px] text-[#737373]">Objection Solved</span>
                <span className="mt-0.5 text-sm font-bold text-emerald-700">
                  {total > 0 ? `${solved} of ${total}` : "—"}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </main>

      <SiteFooter variant="session" />

      <Modal
        open={endOpen}
        onClose={() => setEndOpen(false)}
        title="Conclude Rehearsal?"
        subtitle={`Elapsed time: ${mm}:${ss} • ${exchanges} ${
          exchanges === 1 ? "exchange" : "exchanges"
        } recorded`}
        icon="analytics"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEndOpen(false)}
              className="whitespace-nowrap rounded-lg bg-[#F5F5F5] px-4 py-2 text-xs font-semibold text-[#262626] transition-colors hover:bg-[#EAEAEA]"
            >
              Continue Session
            </button>
            <button
              type="button"
              onClick={endSession}
              className="whitespace-nowrap rounded-lg bg-[#121212] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#262626]"
            >
              View Full Debrief
            </button>
          </>
        }
      >
        Ending now will generate your comprehensive performance debrief
        including negotiation leverage, speech cadence, and suggested
        counter-responses.
      </Modal>
    </div>
  );
}
