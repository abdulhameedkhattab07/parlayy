import "@/lib/net";
import { NextResponse } from "next/server";
import { GradiumClient } from "@gradium/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GradiumRegion = "eu" | "us";

const MIN_REMAINING_TOKEN_MS = 1500;

/**
 * Gradium temporary tokens are bound to the cluster that minted them, so the
 * browser must connect its WebSocket to the same regional host. `api.gradium.ai`
 * auto-routes each request to the nearest cluster, which means the server mint
 * and the user's browser can land in different regions (the browser then gets
 * "Invalid or expired token"). Pin both sides to one region instead.
 */
const EU_VERCEL_REGIONS = new Set([
  "lhr1", // London
  "cdg1", // Paris
  "fra1", // Frankfurt
  "ams1", // Amsterdam
  "dub1", // Dublin
  "arn1", // Stockholm
  "hel1", // Helsinki
  "bru1", // Brussels
  "mad1", // Madrid
  "mxp1", // Milan
  "waw1", // Warsaw
  "prg1", // Prague
  "cpt1", // Cape Town (closest Gradium cluster is EU)
]);

function resolveRegion(): GradiumRegion {
  const explicit = process.env.GRADIUM_REGION?.trim().toLowerCase();
  if (explicit === "eu" || explicit === "us") return explicit;

  const vercelRegion = process.env.VERCEL_REGION?.trim().toLowerCase();
  if (vercelRegion) {
    return EU_VERCEL_REGIONS.has(vercelRegion) ? "eu" : "us";
  }

  // Local development and non-Vercel hosts default to the US cluster. Set
  // GRADIUM_REGION=eu to use the EU cluster instead.
  return "us";
}

function tokenResponse(
  token: string,
  region: GradiumRegion,
  expiresAt: string | null,
  expiresInMs: number | null,
) {
  return NextResponse.json(
    {
      token,
      region,
      expires_at: expiresAt,
      expires_in_ms: expiresInMs,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

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

  const region = resolveRegion();
  const baseUrl = `https://${region}.api.gradium.ai/api/`;
  let lastDetail = "unknown error";
  let best: {
    token: string;
    expiresAt: string | null;
    expiresInMs: number | null;
  } | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const client = new GradiumClient({ apiKey, baseUrl });
      const { token, expires_at } = await client.tempToken({
        timeoutMs: 20000,
      });
      if (!token) {
        lastDetail = "the service did not return a token";
      } else {
        const expiresAt =
          typeof expires_at === "string" && expires_at ? expires_at : null;
        const parsed = expiresAt ? Date.parse(expiresAt) : Number.NaN;
        const expiresInMs = Number.isFinite(parsed)
          ? parsed - Date.now()
          : null;

        if (expiresInMs === null || expiresInMs >= MIN_REMAINING_TOKEN_MS) {
          return tokenResponse(token, region, expiresAt, expiresInMs);
        }

        lastDetail = `the token expires in ${Math.max(0, Math.round(expiresInMs))}ms`;
        if (!best || expiresInMs > (best.expiresInMs ?? 0)) {
          best = { token, expiresAt, expiresInMs };
        }
      }
    } catch (err) {
      lastDetail = describeError(err);
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  if (best) {
    const remaining = best.expiresAt
      ? Date.parse(best.expiresAt) - Date.now()
      : null;
    if (remaining === null || remaining > 0) {
      console.warn(
        `[gradium] returning short-lived ${region} token (${remaining ?? "unknown"}ms remaining)`,
      );
      return tokenResponse(best.token, region, best.expiresAt, remaining);
    }
    lastDetail = "every minted token expired before it could be returned";
  }

  console.error(`[gradium] tempToken failed in ${region}: ${lastDetail}`);
  return NextResponse.json(
    { error: `Could not create a Gradium voice token (${lastDetail}).` },
    { status: 502 },
  );
}
