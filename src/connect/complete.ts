export type ConnectionRecord = {
  googleAccountSub: string;
  googleRefreshToken: string;
  calendarId: string;
  workspaceSlug: string;
  timezone: string;
};

export type ConnectionStore = {
  findByGoogleAccountSub(
    sub: string,
  ): Promise<
    | (Omit<ConnectionRecord, "calendarId" | "workspaceSlug"> & {
        calendarId: string | null;
        workspaceSlug: string | null;
      })
    | null
  >;
  save(connection: ConnectionRecord): Promise<void>;
};

export type DedicatedCalendar = {
  create(input: { summary: string }): Promise<{ id: string }>;
};

export async function completeConnect(input: {
  google: { sub: string; refreshToken: string | null };
  workspaceSlug: string;
  timezone: string;
  connections: ConnectionStore;
  calendars: DedicatedCalendar;
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
  const connection: ConnectionRecord = {
    googleAccountSub: input.google.sub,
    googleRefreshToken: refreshToken,
    calendarId,
    workspaceSlug: input.workspaceSlug,
    timezone: input.timezone,
  };
  await input.connections.save(connection);
  return connection;
}
