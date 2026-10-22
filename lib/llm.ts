import "@/lib/net";

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

interface ProviderConfig {
  baseUrl: string;
  style: "openai" | "anthropic";
  defaultModel: string;
  supportsJsonMode: boolean;
}

const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  openai: ["LLM_API_KEY", "OPENAI_API_KEY"],
  openrouter: ["LLM_API_KEY", "OPENROUTER_API_KEY"],
  groq: ["LLM_API_KEY", "GROQ_API_KEY"],
  anthropic: ["LLM_API_KEY", "ANTHROPIC_API_KEY"],
};

const FREE_SCENARIO_MODEL = "nvidia/nemotron-3.5-lightning:free";

export function defaultScenarioModel(): string | undefined {
  if (process.env.LLM_BASE_URL?.trim()) return undefined;
  return inferProvider() === "openrouter" ? FREE_SCENARIO_MODEL : undefined;
}

function firstEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function inferProvider(): string {
  const explicit = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (process.env.GROQ_API_KEY?.trim()) return "groq";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  return "openai";
}

function resolveProvider(): { config: ProviderConfig; apiKey: string } | null {
  const provider = inferProvider();
  const apiKey = firstEnv(PROVIDER_ENV_KEYS[provider] ?? ["LLM_API_KEY"]);
  if (!apiKey) return null;

  const overrideBase = process.env.LLM_BASE_URL?.trim() || undefined;

  const presets: Record<string, ProviderConfig> = {
    openai: {
      baseUrl: "https://api.openai.com/v1",
      style: "openai",
      defaultModel: "gpt-4o-mini",
      supportsJsonMode: true,
    },
    openrouter: {
      baseUrl: "https://openrouter.ai/api/v1",
      style: "openai",
      defaultModel: "minimax/minimax-m3.1-flash",
      supportsJsonMode: false,
    },
    groq: {
      baseUrl: "https://api.groq.com/openai/v1",
      style: "openai",
      defaultModel: "llama-3.3-70b-versatile",
      supportsJsonMode: true,
    },
    anthropic: {
      baseUrl: "https://api.anthropic.com/v1",
      style: "anthropic",
      defaultModel: "claude-3-5-sonnet-latest",
      supportsJsonMode: false,
    },
  };

  const preset = presets[provider];
  if (!preset && !overrideBase) return null;

  const config: ProviderConfig = preset
    ? { ...preset, baseUrl: overrideBase ?? preset.baseUrl }
    : {
        baseUrl: overrideBase as string,
        style: "openai",
        defaultModel: "",
        supportsJsonMode: true,
      };

  if (process.env.LLM_MODEL?.trim()) config.defaultModel = process.env.LLM_MODEL.trim();
  if (!config.defaultModel) config.defaultModel = "gpt-4o-mini";

  return { config, apiKey };
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function extractJson<T = unknown>(text: string): T {
  const cleaned = stripCodeFences(text);
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  const candidate =
    first !== -1 && last !== -1 && last > first
      ? cleaned.slice(first, last + 1)
      : cleaned;
  return JSON.parse(candidate) as T;
}

function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error";
  const cause = (err as { cause?: unknown }).cause;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code?: unknown }).code)
      : undefined;
  const detail =
    code ?? (cause instanceof Error ? cause.message : undefined);
  return detail ? `${err.message} [${detail}]` : err.message;
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "";
  }
}

const RETRY_DELAYS_MS = [400, 900];

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const started = Date.now();
    try {
      return await fetch(url, init);
    } catch (err) {
      lastError = err;
      console.warn(
        `[llm] attempt ${attempt + 1}/${attempts} failed in ${Date.now() - started}ms: ${describeFetchError(err)}`,
      );
      if (init.signal?.aborted) throw err;
      if (attempt < attempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS_MS[attempt] ?? 900),
        );
      }
    }
  }
  throw lastError;
}

export async function chatComplete(
  messages: LlmMessage[],
  opts: {
    model?: string;
    json?: boolean;
    maxTokens?: number;
    temperature?: number;
    reasoning?: "off" | "minimal" | "low" | "medium" | "high";
  } = {},
): Promise<string> {
  const resolved = resolveProvider();
  if (!resolved) {
    throw new LlmError(
      "No LLM credentials configured. Set LLM_PROVIDER and an API key (e.g. OPENROUTER_API_KEY) in .env.local.",
      500,
    );
  }
  const { config, apiKey } = resolved;
  const model = opts.model?.trim() || config.defaultModel;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    if (config.style === "anthropic") {
      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
      const turns = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }));

      const res = await fetchWithRetry(`${config.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: opts.maxTokens ?? 900,
          temperature: opts.temperature ?? 0.8,
          system,
          messages: turns,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new LlmError(
          `LLM request failed (${res.status})${detail ? `: ${detail}` : ""}`,
          502,
        );
      }
      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
      };
      const text = (data.content ?? [])
        .map((c) => c.text ?? "")
        .join("")
        .trim();
      if (!text) throw new LlmError("LLM returned an empty response", 502);
      return text;
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 900,
    };
    if (opts.json && config.supportsJsonMode) {
      body.response_format = { type: "json_object" };
    }
    if (config.baseUrl.includes("openrouter.ai")) {
      // Reasoning tokens count against max_tokens. Keep them bounded so the
      // model cannot burn the whole budget thinking and return empty content.
      body.reasoning =
        opts.reasoning === "off"
          ? { enabled: false, exclude: true }
          : {
              effort: opts.reasoning ?? (opts.json ? "low" : "minimal"),
              exclude: true,
            };
    }

    const res = await fetchWithRetry(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await readErrorBody(res);
      throw new LlmError(
        `LLM request failed (${res.status})${detail ? `: ${detail}` : ""}`,
        502,
      );
    }
    const data = (await res.json()) as {
      choices?: {
        message?: { content?: string | null };
        finish_reason?: string | null;
      }[];
      usage?: {
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const choice = data.choices?.[0];
    const text = choice?.message?.content?.trim();
    if (!text) {
      const reasoningTokens =
        data.usage?.completion_tokens_details?.reasoning_tokens;
      const details = [
        choice?.finish_reason ? `finish_reason: ${choice.finish_reason}` : null,
        reasoningTokens != null ? `reasoning tokens: ${reasoningTokens}` : null,
      ]
        .filter(Boolean)
        .join("; ");
      console.error(
        `[llm] empty response from ${model}${details ? ` (${details})` : ""}`,
      );
      throw new LlmError(
        `LLM returned an empty response${
          details ? ` (${details})` : ""
        }. The model may have spent the entire output budget reasoning; raise maxTokens or lower its reasoning effort.`,
        502,
      );
    }
    return text;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new LlmError("LLM request timed out", 504);
    }
    console.error(
      `[llm] request to ${config.baseUrl} (model ${model}) failed: ${describeFetchError(err)}`,
    );
    throw new LlmError(
      `Could not reach the LLM provider at ${config.baseUrl} (model ${model}): ${describeFetchError(err)}`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}
