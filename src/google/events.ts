import { z } from "zod";
import { googleHttpErrorFromResponse } from "./errors";
import type { CalendarEventPage } from "@/catch-up/loader";
import type { CalendarEvents, WrittenEvent } from "@/projection/project";

const writtenEventSchema = z.object({
  id: z.string(),
  etag: z.string(),
  status: z.string().optional(),
});

const eventDateSchema = z
  .object({ date: z.string().optional() })
  .optional()
  .transform((value) => ({ date: value?.date ?? null }));

const eventPageSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        etag: z.string(),
        summary: z.string().optional(),
        description: z.string().optional(),
        start: eventDateSchema,
        end: eventDateSchema,
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});

const EVENT_PAGE_FIELDS =
  "nextPageToken,items(id,etag,summary,description,start,end)";

export type CalendarEventListing = {
  listPage(calendarId: string, pageToken: string | null): Promise<CalendarEventPage>;
};

export function googleCalendarEvents(
  accessToken: string,
): CalendarEvents & CalendarEventListing {
  return {
    async listPage(calendarId, pageToken) {
      const params = new URLSearchParams({
        maxResults: "2500",
        fields: EVENT_PAGE_FIELDS,
      });
      if (pageToken != null) {
        params.set("pageToken", pageToken);
      }
      const response = await calendarFetch(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      );
      if (!response.ok) {
        throw await googleHttpErrorFromResponse(response);
      }
      const body = eventPageSchema.parse(await response.json());
      return {
        events: (body.items ?? []).map((item) => ({
          id: item.id,
          etag: item.etag,
          summary: item.summary ?? "",
          description: item.description ?? "",
          start: item.start,
          end: item.end,
        })),
        nextPageToken: body.nextPageToken ?? null,
      };
    },
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
