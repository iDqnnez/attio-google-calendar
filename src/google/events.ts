import { z } from "zod";
import { googleHttpErrorFromResponse } from "./errors";
import type { CalendarEvents, WrittenEvent } from "@/projection/project";

const writtenEventSchema = z.object({
  id: z.string(),
  etag: z.string(),
  status: z.string().optional(),
});

export function googleCalendarEvents(accessToken: string): CalendarEvents {
  return {
    async get(calendarId, eventId) {
      const response = await calendarFetch(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      );
      if (response.status === 404) {
        return null;
      }
      return parseWrittenEvent(response);
    },
    async insert(calendarId, event) {
      const response = await calendarFetch(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
        {
          method: "POST",
          body: JSON.stringify({ ...event, status: "confirmed" }),
        },
      );
      return parseWrittenEvent(response);
    },
    async update(calendarId, event, etag) {
      const response = await calendarFetch(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}?sendUpdates=none`,
        {
          method: "PUT",
          headers: { "If-Match": etag },
          body: JSON.stringify({ ...event, status: "confirmed" }),
        },
      );
      return parseWrittenEvent(response);
    },
    async delete(calendarId, eventId) {
      const response = await calendarFetch(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
        { method: "DELETE" },
      );
      if (
        response.ok ||
        response.status === 404 ||
        response.status === 410
      ) {
        return;
      }
      throw await googleHttpErrorFromResponse(response);
    },
  };
}

async function calendarFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers,
  });
}

async function parseWrittenEvent(response: Response): Promise<WrittenEvent> {
  if (!response.ok) {
    throw await googleHttpErrorFromResponse(response);
  }
  return writtenEventSchema.parse(await response.json());
}
