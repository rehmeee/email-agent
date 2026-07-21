import { NextResponse } from "next/server";
import { listGmailConnectionsNeedingWatchRenewal } from "@/lib/gmail/connection";
import { registerGmailWatchForUser } from "@/lib/gmail/watch";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  // Local/dev without CRON_SECRET: allow manual curls.
  if (!secret) return process.env.NODE_ENV !== "production";

  // Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userIds = await listGmailConnectionsNeedingWatchRenewal();
    const renewed: string[] = [];
    const failed: Array<{ userId: string; error: string }> = [];

    for (const userId of userIds) {
      try {
        await registerGmailWatchForUser(userId);
        renewed.push(userId);
      } catch (error) {
        failed.push({
          userId,
          error: error instanceof Error ? error.message : "Renew failed",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      checked: userIds.length,
      renewed: renewed.length,
      failed,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Watch renewal failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
