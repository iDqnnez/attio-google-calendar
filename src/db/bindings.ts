import type { BindingRecord, BindingStore } from "@/projection/project";
import { prisma } from "./prisma";

export async function listBoundTaskIds(query: {
  limit: number;
  offset: number;
}): Promise<string[]> {
  const rows = await prisma.binding.findMany({
    select: { taskId: true },
    orderBy: { taskId: "asc" },
    skip: query.offset,
    take: query.limit,
  });
  return rows.map((row) => row.taskId);
}

export const prismaBindingStore: BindingStore = {
  async findByTaskId(taskId) {
    const row = await prisma.binding.findUnique({ where: { taskId } });
    if (row == null) {
      return null;
    }
    return toBinding(row);
  },
  async save(binding) {
    await prisma.binding.upsert({
      where: { taskId: binding.taskId },
      create: binding,
      update: {
        calendarId: binding.calendarId,
        eventId: binding.eventId,
        etag: binding.etag,
      },
    });
  },
  async deleteByTaskId(taskId) {
    await prisma.binding.deleteMany({ where: { taskId } });
  },
};

function toBinding(row: {
  taskId: string;
  calendarId: string;
  eventId: string;
  etag: string;
}): BindingRecord {
  return {
    taskId: row.taskId,
    calendarId: row.calendarId,
    eventId: row.eventId,
    etag: row.etag,
  };
}
