import { describe, expect, it } from "vitest";
import {
  completeConnect,
  type AttioWebhookRegistry,
  type ConnectionRecord,
  type ConnectionStore,
  type DedicatedCalendar,
} from "./complete";

const SUB = "google-account-sub-1";
const REFRESH = "refresh-token-1";
const WORKSPACE = "acme";
const TIMEZONE = "Europe/Stockholm";
const WEBHOOK_URL = "https://app.example.com/api/webhooks/attio";

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

function fakeWebhooks() {
  const created: Parameters<AttioWebhookRegistry["create"]>[0][] = [];

  const webhooks: AttioWebhookRegistry = {
    async create(input) {
      created.push(input);
      return {
        id: `webhook-${created.length}`,
        secret: `secret-${created.length}`,
      };
    },
  };

  return { webhooks, created };
}

function fakeBackfill() {
  const enqueued: number[] = [];
  return {
    enqueueBackfill: async () => {
      enqueued.push(enqueued.length + 1);
    },
    enqueued,
  };
}

const storedConnection: ConnectionRecord = {
  googleAccountSub: SUB,
  googleRefreshToken: REFRESH,
  calendarId: "calendar-1",
  workspaceSlug: WORKSPACE,
  timezone: TIMEZONE,
  attioWebhookId: "webhook-1",
  attioWebhookSecret: "secret-1",
};

describe("completeConnect", () => {
  it("first connect creates an Attio Tasks Calendar and stores the Connection", async () => {
    const connections = memoryStore();
    const { calendars, created } = fakeCalendars();
    const { webhooks } = fakeWebhooks();
    const backfill = fakeBackfill();

    await completeConnect({
      google: { sub: SUB, refreshToken: REFRESH },
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
      webhookTargetUrl: WEBHOOK_URL,
      connections,
      calendars,
      webhooks,
      enqueueBackfill: backfill.enqueueBackfill,
    });

    const stored = await connections.findByGoogleAccountSub(SUB);
    expect(stored).toEqual({
      googleAccountSub: SUB,
      googleRefreshToken: REFRESH,
      calendarId: "calendar-1",
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
      attioWebhookId: "webhook-1",
      attioWebhookSecret: "secret-1",
    });
    expect(created).toEqual([{ id: "calendar-1", summary: "Attio Tasks" }]);
  });

  it("first connect registers Attio webhooks for the three Task events and enqueues Backfill", async () => {
    const connections = memoryStore();
    const { calendars } = fakeCalendars();
    const { webhooks, created } = fakeWebhooks();
    const backfill = fakeBackfill();

    await completeConnect({
      google: { sub: SUB, refreshToken: REFRESH },
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
      webhookTargetUrl: WEBHOOK_URL,
      connections,
      calendars,
      webhooks,
      enqueueBackfill: backfill.enqueueBackfill,
    });

    expect(created).toEqual([
      {
        targetUrl: WEBHOOK_URL,
        subscriptions: [
          { eventType: "task.created", filter: null },
          { eventType: "task.updated", filter: null },
          { eventType: "task.deleted", filter: null },
        ],
      },
    ]);
    expect(backfill.enqueued).toEqual([1]);
  });

  it("re-connect reuses the stored Calendar instead of creating another", async () => {
    const existing: ConnectionRecord = {
      ...storedConnection,
      workspaceSlug: "old-slug",
      timezone: "UTC",
    };
    const connections = memoryStore([existing]);
    const { calendars, created } = fakeCalendars();
    const { webhooks } = fakeWebhooks();
    const backfill = fakeBackfill();

    await completeConnect({
      google: { sub: SUB, refreshToken: "refresh-token-2" },
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
      webhookTargetUrl: WEBHOOK_URL,
      connections,
      calendars,
      webhooks,
      enqueueBackfill: backfill.enqueueBackfill,
    });

    const stored = await connections.findByGoogleAccountSub(SUB);
    expect(stored).toEqual({
      googleAccountSub: SUB,
      googleRefreshToken: "refresh-token-2",
      calendarId: "calendar-1",
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
      attioWebhookId: "webhook-1",
      attioWebhookSecret: "secret-1",
    });
    expect(created).toEqual([]);
  });

  it("re-connect reuses the stored webhook and does not register a duplicate", async () => {
    const connections = memoryStore([storedConnection]);
    const { calendars } = fakeCalendars();
    const { webhooks, created } = fakeWebhooks();
    const backfill = fakeBackfill();

    await completeConnect({
      google: { sub: SUB, refreshToken: "refresh-token-2" },
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
      webhookTargetUrl: WEBHOOK_URL,
      connections,
      calendars,
      webhooks,
      enqueueBackfill: backfill.enqueueBackfill,
    });

    expect(created).toEqual([]);
    expect(backfill.enqueued).toEqual([1]);
  });

  it("re-connect without a new refresh token keeps the stored token", async () => {
    const connections = memoryStore([storedConnection]);
    const { calendars } = fakeCalendars();
    const { webhooks } = fakeWebhooks();
    const backfill = fakeBackfill();

    await completeConnect({
      google: { sub: SUB, refreshToken: null },
      workspaceSlug: WORKSPACE,
      timezone: TIMEZONE,
      webhookTargetUrl: WEBHOOK_URL,
      connections,
      calendars,
      webhooks,
      enqueueBackfill: backfill.enqueueBackfill,
    });

    const stored = await connections.findByGoogleAccountSub(SUB);
    expect(stored?.googleRefreshToken).toBe(REFRESH);
  });

  it("first connect without a refresh token does not store a Connection", async () => {
    const connections = memoryStore();
    const { calendars, created } = fakeCalendars();
    const { webhooks, created: webhooksCreated } = fakeWebhooks();
    const backfill = fakeBackfill();

    await expect(
      completeConnect({
        google: { sub: SUB, refreshToken: null },
        workspaceSlug: WORKSPACE,
        timezone: TIMEZONE,
        webhookTargetUrl: WEBHOOK_URL,
        connections,
        calendars,
        webhooks,
        enqueueBackfill: backfill.enqueueBackfill,
      }),
    ).rejects.toThrow("Google did not return a refresh token");

    expect(await connections.findByGoogleAccountSub(SUB)).toBeNull();
    expect(created).toEqual([]);
    expect(webhooksCreated).toEqual([]);
    expect(backfill.enqueued).toEqual([]);
  });
});
