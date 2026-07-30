import { getCalendarEvent } from "@/lib/calendar/api";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createNotification } from "@/lib/notifications/db";
import {
  deleteMeetingWatch,
  listDueMeetingWatches,
  nextDueLead,
  updateMeetingWatch,
  type MeetingWatchRecord,
} from "@/lib/meetings/watches";

/**
 * Meeting mini-agent: notify when start is within ~40 minutes.
 * Hit via external cron every ~30 minutes (Vercel Hobby cannot do sub-daily cron).
 * Cancelled/deleted → delete watch, no notify.
 * Rescheduled → update starts_at.
 * Still on → notify once per lead; delete when done.
 */
export async function runMeetingMiniAgent() {
  const due = await listDueMeetingWatches(100);
  let notified = 0;
  let removed = 0;
  let updated = 0;
  const errors: Array<{ watchId: string; error: string }> = [];

  const byUser = new Map<string, MeetingWatchRecord[]>();
  for (const watch of due) {
    const list = byUser.get(watch.userId) ?? [];
    list.push(watch);
    byUser.set(watch.userId, list);
  }

  for (const [userId, watches] of byUser) {
    let accessToken: string;
    try {
      ({ accessToken } = await getValidGmailAccessToken(userId, {
        skipScopeCheck: true,
      }));
    } catch (error) {
      errors.push({
        watchId: watches[0]?.id ?? userId,
        error: error instanceof Error ? error.message : "Token failed",
      });
      continue;
    }

    for (const watch of watches) {
      try {
        const lead = nextDueLead(watch);
        if (lead == null) continue;

        const isGmailSourced = watch.calendarEventId.startsWith("gmail:");

        if (isGmailSourced) {
          const startMs = Date.parse(watch.startsAt);
          if (!Number.isFinite(startMs) || startMs < Date.now() - 5 * 60_000) {
            await deleteMeetingWatch(watch.id);
            removed += 1;
            continue;
          }

          const minsLeft = Math.max(
            1,
            Math.round((startMs - Date.now()) / 60_000)
          );
          const when = new Date(startMs).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          });

          await createNotification({
            userId: watch.userId,
            type: "meeting_reminder",
            title: `Meeting in ${minsLeft} min: ${watch.title}`,
            body: `Starts ${when}`,
            dedupeKey: `meeting_reminder:${watch.calendarEventId}:${lead}`,
            payload: {
              calendarEventId: watch.calendarEventId,
              title: watch.title,
              startsAt: watch.startsAt,
              leadMinutes: lead,
              minutesLeft: minsLeft,
              source: "gmail_invite",
            },
          });
          notified += 1;

          const firedLeads = [...watch.firedLeads, lead];
          const remaining = watch.leadMinutes.filter(
            (item) => !firedLeads.includes(item)
          );
          if (remaining.length === 0) {
            await deleteMeetingWatch(watch.id);
            removed += 1;
          } else {
            await updateMeetingWatch({ id: watch.id, firedLeads });
            updated += 1;
          }
          continue;
        }

        const live = await getCalendarEvent(
          accessToken,
          watch.calendarEventId
        );

        if (!live) {
          await deleteMeetingWatch(watch.id);
          removed += 1;
          continue;
        }

        const liveStart = live.start;
        const liveStartMs = Date.parse(liveStart);
        const watchedStartMs = Date.parse(watch.startsAt);

        if (
          Number.isFinite(liveStartMs) &&
          Number.isFinite(watchedStartMs) &&
          Math.abs(liveStartMs - watchedStartMs) > 60_000
        ) {
          await updateMeetingWatch({
            id: watch.id,
            startsAt: new Date(liveStartMs).toISOString(),
            title: live.summary,
            firedLeads: [],
          });
          updated += 1;
          continue;
        }

        const minsLeft = Number.isFinite(liveStartMs)
          ? Math.max(1, Math.round((liveStartMs - Date.now()) / 60_000))
          : lead;
        const when = Number.isFinite(liveStartMs)
          ? new Date(liveStartMs).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : liveStart;

        await createNotification({
          userId: watch.userId,
          type: "meeting_reminder",
          title: `Meeting in ${minsLeft} min: ${live.summary}`,
          body: `Starts ${when}${live.location ? ` · ${live.location}` : ""}`,
          dedupeKey: `meeting_reminder:${watch.calendarEventId}:${lead}`,
          payload: {
            calendarEventId: watch.calendarEventId,
            title: live.summary,
            startsAt: live.start,
            leadMinutes: lead,
            minutesLeft: minsLeft,
            hangoutLink: live.hangoutLink,
          },
        });
        notified += 1;

        const firedLeads = [...watch.firedLeads, lead];
        const remaining = watch.leadMinutes.filter(
          (item) => !firedLeads.includes(item)
        );

        if (remaining.length === 0) {
          await deleteMeetingWatch(watch.id);
          removed += 1;
        } else {
          await updateMeetingWatch({ id: watch.id, firedLeads });
          updated += 1;
        }
      } catch (error) {
        errors.push({
          watchId: watch.id,
          error:
            error instanceof Error ? error.message : "Meeting check failed",
        });
      }
    }
  }

  return {
    ok: true,
    due: due.length,
    notified,
    removed,
    updated,
    errors,
  };
}
