import { NextResponse } from "next/server";
import { runMailMindAgent } from "@/lib/agent/graph";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { getPersonaProfile } from "@/lib/persona/db";
import { createClient } from "@/lib/supabase/server";

const buildingLocks = new Set<string>();

function isRecentlyBuilding(updatedAt: string, windowMs = 3 * 60 * 1000) {
  const updated = Date.parse(updatedAt);
  if (Number.isNaN(updated)) return false;
  return Date.now() - updated < windowMs;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional escape hatch for future admin/manual refresh only.
  // Normal Gmail reconnect must never rebuild a ready persona.
  const force =
    new URL(request.url).searchParams.get("force") === "1" ||
    new URL(request.url).searchParams.get("force") === "true";

  try {
    const existing = await getPersonaProfile(user.id);

    // First-time only: once ready, skip forever unless force=1.
    if (existing?.status === "ready" && !force) {
      return NextResponse.json({
        reply:
          "Persona already exists. It is only updated from draft feedback, not on Gmail reconnect.",
        status: "ready",
        profile: existing.profile,
        sourceSampleCount: existing.sourceSampleCount,
        skipped: true,
      });
    }

    if (
      !force &&
      existing?.status === "building" &&
      isRecentlyBuilding(existing.updatedAt)
    ) {
      return NextResponse.json({
        reply: "Persona generation is already in progress.",
        status: "building",
        profile: existing.profile,
        sourceSampleCount: existing.sourceSampleCount,
        skipped: true,
      });
    }

    if (buildingLocks.has(user.id)) {
      return NextResponse.json({
        reply: "Persona generation is already in progress.",
        status: "building",
        profile: existing?.profile ?? null,
        sourceSampleCount: existing?.sourceSampleCount ?? 0,
        skipped: true,
      });
    }

    buildingLocks.add(user.id);

    try {
      const { accessToken, googleEmail } = await getValidGmailAccessToken(
        user.id
      );
      const result = await runMailMindAgent({
        eventType: "gmail_connected",
        userId: user.id,
        accessToken,
        gmailEmail: googleEmail,
        traceContext: {
          userId: user.id,
          environment: process.env.NODE_ENV ?? "development",
          tags: ["persona-bootstrap"],
        },
      });

      const persona = await getPersonaProfile(user.id);

      return NextResponse.json({
        reply: result.reply,
        status: persona?.status ?? result.personaStatus ?? "ready",
        profile: persona?.profile ?? null,
        sourceSampleCount: persona?.sourceSampleCount ?? 0,
      });
    } finally {
      buildingLocks.delete(user.id);
    }
  } catch (error) {
    buildingLocks.delete(user.id);
    const message =
      error instanceof Error ? error.message : "Persona bootstrap failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const persona = await getPersonaProfile(user.id);
    return NextResponse.json({
      status: persona?.status ?? null,
      profile: persona?.profile ?? null,
      sourceSampleCount: persona?.sourceSampleCount ?? 0,
      errorMessage: persona?.errorMessage ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load persona";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
