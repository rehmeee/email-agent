import { createAdminClient } from "@/lib/supabase/admin";
import { MEETING_NOTIFY_WITHIN_MINUTES } from "@/lib/notifications/constants";

export type MeetingWatchRecord = {
  id: string;
  userId: string;
  calendarEventId: string;
  title: string;
  startsAt: string;
  leadMinutes: number[];
  firedLeads: number[];
  createdAt: string;
  updatedAt: string;
};

type MeetingWatchRow = {
  id: string;
  user_id: string;
  calendar_event_id: string;
  title: string;
  starts_at: string;
  lead_minutes: number[] | null;
  fired_leads: number[] | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: MeetingWatchRow): MeetingWatchRecord {
  return {
    id: row.id,
    userId: row.user_id,
    calendarEventId: row.calendar_event_id,
    title: row.title,
    startsAt: row.starts_at,
    leadMinutes: row.lead_minutes?.length
      ? row.lead_minutes
      : [MEETING_NOTIFY_WITHIN_MINUTES],
    firedLeads: row.fired_leads ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isMissingTableError(message: string) {
  return (
    message.includes("meeting_watches") &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("Could not find"))
  );
}

export async function upsertMeetingWatch(input: {
  userId: string;
  calendarEventId: string;
  title: string;
  startsAt: string;
  leadMinutes?: number[];
}): Promise<MeetingWatchRecord | null> {
  const startsAtMs = Date.parse(input.startsAt);
  if (!Number.isFinite(startsAtMs)) {
    console.warn("[meeting_watches] invalid startsAt", input.startsAt);
    return null;
  }

  // Don't watch meetings that already started.
  if (startsAtMs <= Date.now()) {
    return null;
  }

  const admin = createAdminClient();
  const leads = input.leadMinutes?.length
    ? input.leadMinutes
    : [MEETING_NOTIFY_WITHIN_MINUTES];

  const { data, error } = await admin
    .from("meeting_watches")
    .upsert(
      {
        user_id: input.userId,
        calendar_event_id: input.calendarEventId,
        title: input.title.slice(0, 300) || "(No title)",
        starts_at: new Date(startsAtMs).toISOString(),
        lead_minutes: leads,
      },
      { onConflict: "user_id,calendar_event_id" }
    )
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) {
      console.warn(
        "[meeting_watches] table missing — run supabase/migrations/012_proactive_notifications.sql"
      );
      return null;
    }
    throw new Error(`Failed to upsert meeting watch: ${error.message}`);
  }

  return data ? mapRow(data as MeetingWatchRow) : null;
}

export async function deleteMeetingWatch(id: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("meeting_watches").delete().eq("id", id);
  if (error && !isMissingTableError(error.message)) {
    throw new Error(`Failed to delete meeting watch: ${error.message}`);
  }
}

export async function updateMeetingWatch(input: {
  id: string;
  startsAt?: string;
  title?: string;
  firedLeads?: number[];
}) {
  const admin = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (input.startsAt) patch.starts_at = input.startsAt;
  if (input.title) patch.title = input.title;
  if (input.firedLeads) patch.fired_leads = input.firedLeads;

  const { error } = await admin
    .from("meeting_watches")
    .update(patch)
    .eq("id", input.id);

  if (error && !isMissingTableError(error.message)) {
    throw new Error(`Failed to update meeting watch: ${error.message}`);
  }
}

/** Meetings due for notify: start is within the next MEETING_NOTIFY_WITHIN_MINUTES. */
export async function listDueMeetingWatches(limit = 80): Promise<MeetingWatchRecord[]> {
  const admin = createAdminClient();
  const withinMs = MEETING_NOTIFY_WITHIN_MINUTES * 60 * 1000;
  const horizon = new Date(Date.now() + withinMs).toISOString();
  const pastGrace = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("meeting_watches")
    .select("*")
    .gte("starts_at", pastGrace)
    .lte("starts_at", horizon)
    .order("starts_at", { ascending: true })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error.message)) return [];
    throw new Error(`Failed to list meeting watches: ${error.message}`);
  }

  const now = Date.now();
  return ((data as MeetingWatchRow[] | null) ?? [])
    .map(mapRow)
    .filter((watch) => {
      const startMs = Date.parse(watch.startsAt);
      if (!Number.isFinite(startMs)) return false;
      // Already started more than grace ago — skip (cleanup elsewhere).
      if (startMs < now - 5 * 60 * 1000) return false;
      return watch.leadMinutes.some((lead) => {
        if (watch.firedLeads.includes(lead)) return false;
        const dueAt = startMs - lead * 60 * 1000;
        return dueAt <= now;
      });
    });
}

export function nextDueLead(watch: MeetingWatchRecord): number | null {
  const startMs = Date.parse(watch.startsAt);
  if (!Number.isFinite(startMs)) return null;
  const now = Date.now();
  const due = watch.leadMinutes
    .filter((lead) => !watch.firedLeads.includes(lead))
    .filter((lead) => startMs - lead * 60 * 1000 <= now)
    .sort((a, b) => b - a);
  return due[0] ?? null;
}
