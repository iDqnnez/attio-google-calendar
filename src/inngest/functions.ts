import { inngest } from "./client";
import {
  attioTaskCreated,
  attioTaskDeleted,
  attioTaskUpdated,
  projectionRequested,
} from "./events";

export const projectTask = inngest.createFunction(
  {
    id: "project-task",
    triggers: [
      attioTaskCreated,
      attioTaskUpdated,
      attioTaskDeleted,
      projectionRequested,
    ],
  },
  async ({ event }) => {
    return { taskId: event.data.taskId };
  },
);

export const functions = [projectTask];
