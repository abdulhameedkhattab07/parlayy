import "@/lib/net";
import { NextResponse } from "next/server";
import { GradiumClient } from "@gradium/sdk";

export const runtime = "nodejs";

function describeError(err: unknown): string {
  const cause = (err as { cause?: unknown })?.cause;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code?: unknown }).code)
      : undefined;
  if (code) return code;
  if (cause instanceof Error) return cause.message;
  if (err instanceof Error) return err.message;
  return "unknown error";
}

export async function POST() {
  const apiKey = process.env.GRADIUM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Gradium is not configured. Set GRADIUM_API_KEY." },
      { status: 500 },
    );
  }

  let lastDetail = "unknown error";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const client = new GradiumClient({ apiKey });
      const { token } = await client.tempToken({ timeoutMs: 20000 });
      if (!token) {
        lastDetail = "the service did not return a token";
      } else {
        return NextResponse.json(
          { token },
          { headers: { "cache-control": "no-store" } },
        );
      }
    } catch (err) {
      lastDetail = describeError(err);
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  console.error(`[gradium] tempToken failed: ${lastDetail}`);
  return NextResponse.json(
    { error: `Could not create a Gradium voice token (${lastDetail}).` },
    { status: 502 },
  );
}
