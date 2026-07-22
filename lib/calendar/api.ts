type FreeBusyResponse = {
  calendars?: Record<
    string,
    {
      busy?: { start: string; end: string }[];
      errors?: { domain?: string; reason?: string }[];
    }
  >;
  error?: { message?: string };
};

type CalendarEventsResponse = {
  items?: {
    id?: string;
    summary?: string;
    status?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
    location?: string;
    hangoutLink?: string;
    htmlLink?: string;
  }[];
  error?: { message?: string };
};

async function calendarFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    }
  );

  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Calendar API request failed");
  }

  return payload;
}

export type BusyBlock = {
  start: string;
  end: string;
};

export type CalendarAvailability = {
  calendarId: string;
  timeMin: string;
  timeMax: string;
  busy: BusyBlock[];
  isFree: boolean;
};

export type CalendarEventSummary = {
  id: string;
  summary: string;
  status: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  hangoutLink: string | null;
};

function eventStartEnd(event: NonNullable<CalendarEventsResponse["items"]>[number]) {
  const start = event.start?.dateTime ?? event.start?.date ?? "";
  const end = event.end?.dateTime ?? event.end?.date ?? "";
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  return { start, end, allDay };
}

export async function getFreeBusy(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  calendarIds: string[] = ["primary"]
): Promise<CalendarAvailability[]> {
  const payload = await calendarFetch<FreeBusyResponse>(
    accessToken,
    "/freeBusy",
    {
      method: "POST",
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: calendarIds.map((id) => ({ id })),
      }),
    }
  );

  return calendarIds.map((calendarId) => {
    const entry = payload.calendars?.[calendarId];
    const busy = (entry?.busy ?? []).map((block) => ({
      start: block.start,
      end: block.end,
    }));

    return {
      calendarId,
      timeMin,
      timeMax,
      busy,
      isFree: busy.length === 0,
    };
  });
}

export async function listCalendarEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  maxResults = 20
): Promise<CalendarEventSummary[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(Math.min(Math.max(maxResults, 1), 50)),
  });

  const payload = await calendarFetch<CalendarEventsResponse>(
    accessToken,
    `/calendars/primary/events?${params.toString()}`
  );

  return (payload.items ?? [])
    .filter((event) => event.status !== "cancelled")
    .map((event) => {
      const { start, end, allDay } = eventStartEnd(event);
      return {
        id: event.id ?? "",
        summary: event.summary?.trim() || "(No title)",
        status: event.status ?? "confirmed",
        start,
        end,
        allDay,
        location: event.location ?? null,
        hangoutLink: event.hangoutLink ?? null,
      };
    });
}
