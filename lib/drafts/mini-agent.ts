import { gmailDraftExists } from "@/lib/gmail/api";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createNotification } from "@/lib/notifications/db";
import {
  deleteDraftWatch,
  deleteExpiredDraftWatches,
  listDueDraftWatches,
  type DraftWatchRecord,
} from "@/lib/drafts/watches";

/**
 * Draft mini-agent: in the last 4h of the 2-day wait, live-check Gmail.
 * Still unsent → one notify then delete watch. Gone → delete, no notify.
 * At most one draft_unsent notify per user per run.
 */
export async function runDraftMiniAgent() {
  const expired = await deleteExpiredDraftWatches();
  const due = await listDueDraftWatches(100);
  const now = Date.now();

  // Still inside hard window (not past window_end)
  const inWindow = due.filter((watch) => Date.parse(watch.windowEnd) > now);

  const byUser = new Map<string, DraftWatchRecord[]>();
  for (const watch of inWindow) {
    const list = byUser.get(watch.userId) ?? [];
    list.push(watch);
    byUser.set(watch.userId, list);
  }

  let notified = 0;
  let removed = 0;
  const errors: Array<{ watchId: string; error: string }> = [];

  for (const [userId, watches] of byUser) {
    // Oldest first
    watches.sort(
      (a, b) => Date.parse(a.windowOpen) - Date.parse(b.windowOpen)
    );

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

    let didNotify = false;

    for (const watch of watches) {
      try {
        const exists = await gmailDraftExists(accessToken, watch.gmailDraftId);
        if (!exists) {
          await deleteDraftWatch(watch.id);
          removed += 1;
          continue;
        }

        if (didNotify) {
          // One notify per user per run — leave remaining for next cron.
          break;
        }

        await createNotification({
          userId: watch.userId,
          type: "draft_unsent",
          title: `Unsent draft: ${watch.subject || "(no subject)"}`,
          body: "I drafted this a couple of days ago and it is still in Gmail Drafts — want to send it?",
          dedupeKey: `draft_unsent:${watch.mailmindDraftId}`,
          payload: {
            mailmindDraftId: watch.mailmindDraftId,
            gmailDraftId: watch.gmailDraftId,
            subject: watch.subject,
          },
        });
        await deleteDraftWatch(watch.id);
        notified += 1;
        removed += 1;
        didNotify = true;
      } catch (error) {
        errors.push({
          watchId: watch.id,
          error: error instanceof Error ? error.message : "Draft check failed",
        });
      }
    }
  }

  return {
    ok: true,
    expiredCleaned: expired,
    due: due.length,
    notified,
    removed,
    errors,
  };
}
