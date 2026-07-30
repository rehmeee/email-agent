export const NOTIFICATION_TYPES = [
  "important_email",
  "draft_unsent",
  "meeting_reminder",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Unread notifications expire after 7 days. */
export const NOTIFICATION_UNREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** After mark-read, expire within 48 hours (or sooner if already nearer). */
export const NOTIFICATION_READ_TTL_MS = 48 * 60 * 60 * 1000;

/** Max notifications retained per user. */
export const NOTIFICATION_MAX_PER_USER = 50;

/** Draft becomes eligible in the last 4 hours of the 2-day wait. */
export const DRAFT_WATCH_DAYS = 2;
export const DRAFT_WATCH_WINDOW_HOURS = 4;
export const DRAFT_WATCH_MAX_PER_USER = 20;

/** Meeting reminder: notify when start is within this many minutes. */
export const MEETING_NOTIFY_WITHIN_MINUTES = 40;

/**
 * External cron should hit meeting drain about this often (Hobby has no sub-daily Vercel cron).
 * 30m cadence + 40m window ≈ timely reminders without missing the window.
 */
export const MEETING_EXTERNAL_CRON_MINUTES = 30;
