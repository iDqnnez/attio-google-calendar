import type { DedicatedCalendar } from "@/connect/complete";
import { z } from "zod";

const createdCalendarSchema = z.object({
  id: z.string(),
});

export function googleDedicatedCalendar(accessToken: string): DedicatedCalendar {
  return {
    async create(input) {
      const response = await fetch(
        "https://www.googleapis.com/calendar/v3/calendars",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ summary: input.summary }),
        },
      );
      if (!response.ok) {
        throw new Error(`Google calendar create failed (${response.status})`);
      }
      return { id: createdCalendarSchema.parse(await response.json()).id };
    },
  };
}
