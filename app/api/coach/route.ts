import { NextResponse } from "next/server";
import { chatComplete, extractJson, LlmError } from "@/lib/llm";
import { buildCoachSystemPrompt, resolveScenario } from "@/lib/prompt";
import { coachRequestSchema, coachResponseSchema } from "@/lib/types";

export const runtime = "nodejs";

function formatTranscript(
  turns: { role: "user" | "counterpart"; text: string }[],
): string {
  return turns
    .map((t) => `${t.role === "user" ? "USER" : "COUNTERPART"}: ${t.text}`)
    .join("\n");
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = coachRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { scenarioId, difficulty, transcript, customScenario } = parsed.data;
  const resolved = resolveScenario(scenarioId, customScenario ?? null);
  if (!resolved) {
    return NextResponse.json({ error: "Unknown scenario." }, { status: 404 });
  }
  const { engine, publicMeta } = resolved;

  const userContent = [
    `SCENARIO: ${publicMeta.title}`,
    `COUNTERPART: ${publicMeta.counterpart.name}`,
    `DIFFICULTY: ${difficulty}`,
    `USER'S GOAL: ${publicMeta.briefing.yourGoal}`,
    `COUNTERPART'S PRIVATE GOAL: ${engine.hiddenGoal}`,
    `COUNTERPART'S OBJECTIONS:\n${engine.objections.map((o) => `- ${o}`).join("\n")}`,
    "",
    "TRANSCRIPT SO FAR:",
    formatTranscript(transcript),
  ].join("\n");

  try {
    const raw = await chatComplete(
      [
        { role: "system", content: buildCoachSystemPrompt() },
        { role: "user", content: userContent },
      ],
      { json: true, maxTokens: 1200, temperature: 0.4, reasoning: "low" },
    );
    const json = extractJson(raw);
    const coach = coachResponseSchema.safeParse(json);
    if (!coach.success) {
      return NextResponse.json(
        { error: "Telemetry was malformed." },
        { status: 502 },
      );
    }
    return NextResponse.json({ coach: coach.data });
  } catch (err) {
    const status = err instanceof LlmError ? err.status : 502;
    const message =
      err instanceof LlmError ? err.message : "Could not compute telemetry.";
    return NextResponse.json({ error: message }, { status });
  }
}
