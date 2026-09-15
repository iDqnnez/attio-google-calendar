import { eventType } from "inngest";
import { z } from "zod";

const taskProjectionData = z.object({
  taskId: z.string().uuid(),
});

export const attioTaskCreated = eventType("attio/task.created", {
  schema: taskProjectionData,
});

export const attioTaskUpdated = eventType("attio/task.updated", {
  schema: taskProjectionData,
});

export const attioTaskDeleted = eventType("attio/task.deleted", {
  schema: taskProjectionData,
});

export const projectionRequested = eventType("app/projection.requested", {
  schema: taskProjectionData,
});
