import { z } from "zod";
import type { AttioTasks } from "@/projection/project";

const taskResponseSchema = z.object({
  data: z.object({
    id: z.object({
      task_id: z.string(),
    }),
    content_plaintext: z.string(),
    deadline_at: z.string().nullable(),
    is_completed: z.boolean(),
  }),
});

export function attioTasks(apiToken: string): AttioTasks {
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
      return {
        id: body.data.id.task_id,
        content: body.data.content_plaintext,
        deadline: body.data.deadline_at,
        isCompleted: body.data.is_completed,
      };
    },
  };
}
