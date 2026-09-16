import type { Task } from "@/projection/decide";

export const OPEN_TASK_PAGE_LIMIT = 500;
export const BACKFILL_ENQUEUE_CHUNK_SIZE = 100;

export async function runBackfillLoader(input: {
  listOpenPage: (query: {
    limit: number;
    offset: number;
  }) => Promise<Array<Pick<Task, "id" | "deadline">>>;
  enqueueChunk: (taskIds: string[]) => Promise<void>;
}): Promise<{ enqueued: number }> {
  let offset = 0;
  let enqueued = 0;

  for (;;) {
    const page = await input.listOpenPage({
      limit: OPEN_TASK_PAGE_LIMIT,
      offset,
    });
    const qualifyingIds = page
      .filter((task) => task.deadline != null)
      .map((task) => task.id);

    for (let i = 0; i < qualifyingIds.length; i += BACKFILL_ENQUEUE_CHUNK_SIZE) {
      const chunk = qualifyingIds.slice(i, i + BACKFILL_ENQUEUE_CHUNK_SIZE);
      await input.enqueueChunk(chunk);
      enqueued += chunk.length;
    }

    if (page.length < OPEN_TASK_PAGE_LIMIT) {
      return { enqueued };
    }
    offset += OPEN_TASK_PAGE_LIMIT;
  }
}
