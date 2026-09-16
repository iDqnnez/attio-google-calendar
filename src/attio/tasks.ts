import { z } from "zod";
import type { Task } from "@/projection/decide";
import type { AttioTasks } from "@/projection/project";

const taskFieldsSchema = z.object({
  id: z.object({
    task_id: z.string(),
  }),
  content_plaintext: z.string(),
  deadline_at: z.string().nullable(),
  is_completed: z.boolean(),
});

const taskResponseSchema = z.object({
  data: taskFieldsSchema,
});

const taskListResponseSchema = z.object({
  data: z.array(taskFieldsSchema),
});

function toTask(data: z.infer<typeof taskFieldsSchema>): Task {
  return {
    id: data.id.task_id,
    content: data.content_plaintext,
    deadline: data.deadline_at,
    isCompleted: data.is_completed,
  };
}

export type AttioOpenTasks = {
  listOpen(query: { limit: number; offset: number }): Promise<Task[]>;
};

export function attioTasks(apiToken: string): AttioTasks & AttioOpenTasks {
  return {
    async get(taskId) {
      const response = await fetch(`https://api.attio.com/v2/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Attio task get failed (${response.status})`);
      }
      const body = taskResponseSchema.parse(await response.json());
      return toTask(body.data);
    },
    async listOpen(query) {
      const url = new URL("https://api.attio.com/v2/tasks");
      url.searchParams.set("is_completed", "false");
      url.searchParams.set("limit", String(query.limit));
      url.searchParams.set("offset", String(query.offset));
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!response.ok) {
        throw new Error(`Attio task list failed (${response.status})`);
      }
      const body = taskListResponseSchema.parse(await response.json());
      return body.data.map(toTask);
    },
  };
}
