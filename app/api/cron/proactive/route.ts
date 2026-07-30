import { NextResponse } from "next/server";
import { cronUnauthorized, isCronAuthorized } from "@/lib/cron-auth";
import { runDraftMiniAgent } from "@/lib/drafts/mini-agent";
import { runMeetingMiniAgent } from "@/lib/meetings/mini-agent";
import { deleteExpiredNotifications } from "@/lib/notifications/db";

export const runtime = "nodejs";
export const maxDuration = 60;

type Task = "meetings" | "drafts" | "cleanup" | "all";

function parseTask(request: Request): Task {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("task") ?? "all").toLowerCase();
  if (raw === "meetings" || raw === "drafts" || raw === "cleanup" || raw === "all") {
    return raw;
  }
  return "all";
}

/**
 * External cron entrypoint (Vercel Hobby cannot run sub-daily Vercel Cron).
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Examples:
 *   GET /api/cron/proactive?task=meetings   — every 30 minutes
 *   GET /api/cron/proactive?task=drafts     — every 4 hours
 *   GET /api/cron/proactive?task=cleanup    — daily
 *   GET /api/cron/proactive?task=all        — runs meetings + drafts + cleanup
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return cronUnauthorized();

  const task = parseTask(request);

  try {
    const result: Record<string, unknown> = { ok: true, task };

    if (task === "meetings" || task === "all") {
      result.meetings = await runMeetingMiniAgent();
    }
    if (task === "drafts" || task === "all") {
      result.drafts = await runDraftMiniAgent();
    }
    if (task === "cleanup" || task === "all") {
      result.cleanup = {
        deleted: await deleteExpiredNotifications({ limit: 500 }),
      };
    }

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Proactive cron failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
