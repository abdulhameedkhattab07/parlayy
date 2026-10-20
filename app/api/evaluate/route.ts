import { NextResponse } from "next/server";
import { chatComplete, extractJson, LlmError } from "@/lib/llm";
import { buildEvaluatorSystemPrompt, resolveScenario } from "@/lib/prompt";
import { evaluateRequestSchema, reportSchema } from "@/lib/types";

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

  const parsed = evaluateRequestSchema.safeParse(body);
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
  const system = buildEvaluatorSystemPrompt(resolved, difficulty);

  const userContent = [
    "Here is the full transcript of the conversation. Evaluate the USER's performance.",
    "Only reference quotes that appear below.",
    "",
    "TRANSCRIPT:",
    formatTranscript(transcript),
  ].join("\n");

  try {
    const raw = await chatComplete(
      [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      { json: true, maxTokens: 4000, temperature: 0.4, reasoning: "low" },
    );
    const json = extractJson(raw);
    const report = reportSchema.safeParse(json);
    if (!report.success) {
      return NextResponse.json(
        { error: "The coaching report was malformed. Try again." },
        { status: 502 },
      );
    }
    return NextResponse.json({ report: report.data });
  } catch (err) {
    const status = err instanceof LlmError ? err.status : 502;
    const message =
      err instanceof LlmError ? err.message : "Could not generate a report.";
    return NextResponse.json({ error: message }, { status });
  }
}
