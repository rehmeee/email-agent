import { NextResponse } from "next/server";
import { cronUnauthorized, isCronAuthorized } from "@/lib/cron-auth";
import { runMeetingMiniAgent } from "@/lib/meetings/mini-agent";

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return cronUnauthorized();

  try {
    const result = await runMeetingMiniAgent();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Meeting watches drain failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
