import { NextResponse } from "next/server";
import { cronUnauthorized, isCronAuthorized } from "@/lib/cron-auth";
import { runDraftMiniAgent } from "@/lib/drafts/mini-agent";

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return cronUnauthorized();

  try {
    const result = await runDraftMiniAgent();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Draft watches drain failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
