import { NextResponse } from "next/server";
import { markNotificationsRead } from "@/lib/notifications/db";
import { createClient } from "@/lib/supabase/server";

type ReadBody = {
  ids?: string[];
  all?: boolean;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ReadBody;
  try {
    body = (await request.json()) as ReadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const updated = await markNotificationsRead({
      userId: user.id,
      ids: body.ids,
      all: Boolean(body.all),
    });
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to mark notifications read";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
