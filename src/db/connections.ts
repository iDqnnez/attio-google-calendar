import type { ConnectionStore } from "@/connect/complete";
import { prisma } from "./prisma";

export const prismaConnectionStore: ConnectionStore = {
  async findByGoogleAccountSub(sub) {
    const row = await prisma.connection.findUnique({
      where: { googleAccountSub: sub },
    });
    if (row == null) {
      return null;
    }
    return {
      googleAccountSub: row.googleAccountSub,
      googleRefreshToken: row.googleRefreshToken,
      calendarId: row.calendarId,
      workspaceSlug: row.workspaceSlug,
      timezone: row.timezone,
    };
  },
  async save(connection) {
    await prisma.connection.upsert({
      where: { googleAccountSub: connection.googleAccountSub },
      create: {
        googleAccountSub: connection.googleAccountSub,
        googleRefreshToken: connection.googleRefreshToken,
        calendarId: connection.calendarId,
        workspaceSlug: connection.workspaceSlug,
        timezone: connection.timezone,
      },
      update: {
        googleRefreshToken: connection.googleRefreshToken,
        calendarId: connection.calendarId,
        workspaceSlug: connection.workspaceSlug,
        timezone: connection.timezone,
      },
    });
  },
};
