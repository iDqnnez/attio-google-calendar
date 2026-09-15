import { describe, expect, it } from "vitest";
import {
  completeConnect,
  type ConnectionRecord,
  type ConnectionStore,
  type DedicatedCalendar,
} from "./complete";

const SUB = "google-account-sub-1";
const REFRESH = "refresh-token-1";
const WORKSPACE = "acme";
const TIMEZONE = "Europe/Stockholm";

function memoryStore(seed: ConnectionRecord[] = []): ConnectionStore {
  const rows = new Map(
    seed.map((connection) => [connection.googleAccountSub, { ...connection }]),
  );

  return {
    async findByGoogleAccountSub(sub) {
      const row = rows.get(sub);
      return row == null ? null : { ...row };
    },
    async save(connection) {
      rows.set(connection.googleAccountSub, { ...connection });
    },
  };
}

function fakeCalendars() {
  const created: { id: string; summary: string }[] = [];

  const calendars: DedicatedCalendar = {
    async create(input) {
      const calendar = {
        id: `calendar-${created.length + 1}`,
        summary: input.summary,
      };
      created.push(calendar);
      return { id: calendar.id };
    },
  };

  return { calendars, created };
}

describe("completeConnect", () => {
  it("first connect creates an Attio Tasks Calendar and stores the Connection", async () => {
    const connections = memoryStore();
    const { calendars, created } = fakeCalendars();

    await completeConnect({
      google: { sub: SUB, refreshToken: REFRESH },
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
      connections,
      calendars,
    });

    const stored = await connections.findByGoogleAccountSub(SUB);
    expect(stored).toEqual({
      googleAccountSub: SUB,
      googleRefreshToken: REFRESH,
      calendarId: "calendar-1",
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
    });
    expect(created).toEqual([{ id: "calendar-1", summary: "Attio Tasks" }]);
  });

  it("re-connect reuses the stored Calendar instead of creating another", async () => {
    const existing: ConnectionRecord = {
      googleAccountSub: SUB,
      googleRefreshToken: REFRESH,
      calendarId: "calendar-1",
      workspaceSlug: "old-slug",
      timezone: "UTC",
    };
    const connections = memoryStore([existing]);
    const { calendars, created } = fakeCalendars();

    await completeConnect({
      google: { sub: SUB, refreshToken: "refresh-token-2" },
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
      connections,
      calendars,
    });

    const stored = await connections.findByGoogleAccountSub(SUB);
    expect(stored).toEqual({
      googleAccountSub: SUB,
      googleRefreshToken: "refresh-token-2",
      calendarId: "calendar-1",
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
    });
    expect(created).toEqual([]);
  });

  it("re-connect without a new refresh token keeps the stored token", async () => {
    const existing: ConnectionRecord = {
      googleAccountSub: SUB,
      googleRefreshToken: REFRESH,
      calendarId: "calendar-1",
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
    };
    const connections = memoryStore([existing]);
    const { calendars } = fakeCalendars();

    await completeConnect({
      google: { sub: SUB, refreshToken: null },
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
      connections,
      calendars,
    });

    const stored = await connections.findByGoogleAccountSub(SUB);
    expect(stored?.googleRefreshToken).toBe(REFRESH);
  });

  it("first connect without a refresh token does not store a Connection", async () => {
    const connections = memoryStore();
    const { calendars, created } = fakeCalendars();

    await expect(
      completeConnect({
        google: { sub: SUB, refreshToken: null },
        workspaceSlug: WORKSPACE,
        timezone: TIMEZONE,
        connections,
        calendars,
      }),
    ).rejects.toThrow("Google did not return a refresh token");

    expect(await connections.findByGoogleAccountSub(SUB)).toBeNull();
    expect(created).toEqual([]);
  });
});
