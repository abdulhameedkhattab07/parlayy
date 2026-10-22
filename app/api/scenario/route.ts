import { NextResponse } from "next/server";
import {
  chatComplete,
  defaultScenarioModel,
  extractJson,
  LlmError,
} from "@/lib/llm";
import { buildScenarioGeneratorPrompt } from "@/lib/prompt";
import {
  customScenarioSchema,
  generatedScenarioSchema,
  scenarioRequestSchema,
} from "@/lib/types";
import { VOICES, getVoice } from "@/lib/voices";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = scenarioRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Describe the conversation in a little more detail." },
      { status: 400 },
    );
  }

  const { brief, rigor } = parsed.data;
  const { system, user } = buildScenarioGeneratorPrompt(brief, rigor);

  try {
    const started = Date.now();
    const raw = await chatComplete(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        model: defaultScenarioModel(),
        json: true,
        maxTokens: 1200,
        temperature: 0.7,
        reasoning: "off",
      },
    );
    console.info(`[scenario] generated in ${Date.now() - started}ms`);
    const json = extractJson(raw);
    const generated = generatedScenarioSchema.safeParse(json);
    if (!generated.success) {
      return NextResponse.json(
        { error: "The scenario could not be generated. Try rephrasing." },
        { status: 502 },
      );
    }

    const data = generated.data;
    const voice = getVoice(data.voiceId) ?? VOICES[0];
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `custom-${crypto.randomUUID().slice(0, 8)}`
        : `custom-${Date.now()}`;

    const customScenario = customScenarioSchema.parse({
      scenario: {
        id,
        title: data.title,
        category: data.category,
        tagline: data.tagline,
        counterpart: data.counterpart,
        voice: { id: voice.id, name: voice.name },
        briefing: data.briefing,
      },
      engine: data.engine,
    });

    return NextResponse.json({ customScenario });
  } catch (err) {
    const status = err instanceof LlmError ? err.status : 502;
    const message =
      err instanceof LlmError
        ? err.message
        : "Could not generate the scenario.";
    return NextResponse.json({ error: message }, { status });
  }
}
