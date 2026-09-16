export type ConnectionRecord = {
  googleAccountSub: string;
  googleRefreshToken: string;
  calendarId: string;
  workspaceSlug: string;
  timezone: string;
  attioWebhookId: string;
  attioWebhookSecret: string;
};

export type ConnectionStore = {
  findByGoogleAccountSub(
    sub: string,
  ): Promise<
    | (Omit<
        ConnectionRecord,
        "calendarId" | "workspaceSlug" | "attioWebhookId" | "attioWebhookSecret"
      > & {
        calendarId: string | null;
        workspaceSlug: string | null;
        attioWebhookId: string | null;
        attioWebhookSecret: string | null;
      })
    | null
  >;
  save(connection: ConnectionRecord): Promise<void>;
};

export type DedicatedCalendar = {
  create(input: { summary: string }): Promise<{ id: string }>;
};

export type TaskWebhookSubscription = {
  eventType: "task.created" | "task.updated" | "task.deleted";
  filter: null;
};

export type AttioWebhookRegistry = {
  create(input: {
    targetUrl: string;
    subscriptions: TaskWebhookSubscription[];
  }): Promise<{ id: string; secret: string }>;
};

const TASK_WEBHOOK_SUBSCRIPTIONS: TaskWebhookSubscription[] = [
  { eventType: "task.created", filter: null },
  { eventType: "task.updated", filter: null },
  { eventType: "task.deleted", filter: null },
];

export async function completeConnect(input: {
  google: { sub: string; refreshToken: string | null };
  workspaceSlug: string;
  timezone: string;
  webhookTargetUrl: string;
  connections: ConnectionStore;
  calendars: DedicatedCalendar;
  webhooks: AttioWebhookRegistry;
  enqueueBackfill: () => Promise<void>;
}): Promise<ConnectionRecord> {
  const existing = await input.connections.findByGoogleAccountSub(
    input.google.sub,
  );
  const refreshToken = input.google.refreshToken ?? existing?.googleRefreshToken;
  if (refreshToken == null) {
    throw new Error("Google did not return a refresh token");
  }

  const calendarId =
    existing?.calendarId ??
    (await input.calendars.create({ summary: "Attio Tasks" })).id;

  const webhook =
    existing?.attioWebhookId != null && existing.attioWebhookSecret != null
      ? { id: existing.attioWebhookId, secret: existing.attioWebhookSecret }
      : await input.webhooks.create({
          targetUrl: input.webhookTargetUrl,
          subscriptions: TASK_WEBHOOK_SUBSCRIPTIONS,
        });

  const connection: ConnectionRecord = {
    googleAccountSub: input.google.sub,
    googleRefreshToken: refreshToken,
    calendarId,
    workspaceSlug: input.workspaceSlug,
    timezone: input.timezone,
    attioWebhookId: webhook.id,
    attioWebhookSecret: webhook.secret,
  };
  await input.connections.save(connection);
  await input.enqueueBackfill();
  return connection;
}
