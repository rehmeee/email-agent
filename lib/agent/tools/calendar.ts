import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getFreeBusy, listCalendarEvents } from "@/lib/calendar/api";

const isoDateTime = z
  .string()
  .min(1)
  .describe(
    "ISO 8601 date-time with timezone, e.g. 2026-07-21T15:00:00-05:00 or 2026-07-21T20:00:00Z"
  );

export function createCalendarReadTools(accessToken: string) {
  const checkAvailability = tool(
    async ({ timeMin, timeMax }) => {
      if (new Date(timeMin).getTime() >= new Date(timeMax).getTime()) {
        return JSON.stringify({
          error: "timeMin must be before timeMax",
        });
      }

      const availability = await getFreeBusy(accessToken, timeMin, timeMax);
      return JSON.stringify(availability, null, 2);
    },
    {
      name: "check_availability",
      description:
        "Check whether the user is free or busy on their primary Google Calendar for a time range. Use for availability questions like 'Am I free Tuesday at 3pm?'. Returns busy blocks and isFree.",
      schema: z.object({
        timeMin: isoDateTime,
        timeMax: isoDateTime,
      }),
    }
  );

  const listEvents = tool(
    async ({ timeMin, timeMax, maxResults }) => {
      if (new Date(timeMin).getTime() >= new Date(timeMax).getTime()) {
        return JSON.stringify({
          error: "timeMin must be before timeMax",
        });
      }

      const events = await listCalendarEvents(
        accessToken,
        timeMin,
        timeMax,
        maxResults ?? 20
      );
      return JSON.stringify(events, null, 2);
    },
    {
      name: "list_calendar_events",
      description:
        "List events on the user's primary Google Calendar in a time range. Use for questions like 'What's on my calendar today?' or to see meeting titles before proposing times.",
      schema: z.object({
        timeMin: isoDateTime,
        timeMax: isoDateTime,
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum events to return. Defaults to 20."),
      }),
    }
  );

  return [checkAvailability, listEvents];
}
