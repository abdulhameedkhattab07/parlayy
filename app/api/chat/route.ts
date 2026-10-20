import { NextResponse } from "next/server";
import { chatComplete, LlmError, type LlmMessage } from "@/lib/llm";
import { buildCounterpartSystemPrompt, resolveScenario } from "@/lib/prompt";
import { chatRequestSchema } from "@/lib/types";

export const runtime = "nodejs";

function sanitizeSpoken(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>|]/g, " ")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 700);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(body);
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
  const system = buildCounterpartSystemPrompt(resolved, difficulty);

  const messages: LlmMessage[] = [{ role: "system", content: system }];
  for (const turn of transcript) {
    messages.push({
      role: turn.role === "user" ? "user" : "assistant",
      content: turn.text,
    });
  }
  if (transcript.length === 0) {
    messages.push({
      role: "user",
      content:
        "(The user has just joined and has not spoken yet. Open the conversation in character with a brief, natural opening line, then stop and let them respond.)",
    });
  }

  try {
    const raw = await chatComplete(messages, {
      maxTokens: 800,
      reasoning: "low",
      temperature: 0.85,
    });
    const reply = sanitizeSpoken(raw);
    if (!reply) {
      return NextResponse.json(
        { error: "The counterpart did not produce a response." },
        { status: 502 },
      );
    }
    return NextResponse.json({ reply });
  } catch (err) {
    const status = err instanceof LlmError ? err.status : 502;
    const message =
      err instanceof LlmError ? err.message : "Counterpart is unavailable.";
    return NextResponse.json({ error: message }, { status });
  }
}
