import type { Task } from "@/projection/decide";

export const CATCH_UP_PAGE_LIMIT = 500;
export const CATCH_UP_ENQUEUE_CHUNK_SIZE = 100;

export async function runCatchUpLoader(input: {
  listOpenPage: (query: {
    limit: number;
    offset: number;
  }) => Promise<Array<Pick<Task, "id" | "deadline">>>;
  listBoundTaskIds: (query: {
    limit: number;
    offset: number;
  }) => Promise<string[]>;
  enqueueChunk: (taskIds: string[]) => Promise<void>;
}): Promise<{ enqueued: number }> {
  const taskIds = new Set<string>();

  await forEachPage(input.listOpenPage, (task) => {
    if (task.deadline != null) {
      taskIds.add(task.id);
    }
  });
  await forEachPage(input.listBoundTaskIds, (taskId) => {
    taskIds.add(taskId);
  });

  const ids = [...taskIds];
  for (let i = 0; i < ids.length; i += CATCH_UP_ENQUEUE_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CATCH_UP_ENQUEUE_CHUNK_SIZE);
    await input.enqueueChunk(chunk);
  }
  return { enqueued: ids.length };
}

async function forEachPage<T>(
  listPage: (query: { limit: number; offset: number }) => Promise<T[]>,
  visit: (item: T) => void,
): Promise<void> {
  let offset = 0;
  for (;;) {
    const page = await listPage({
      limit: CATCH_UP_PAGE_LIMIT,
      offset,
    });
    for (const item of page) {
      visit(item);
    }
    if (page.length < CATCH_UP_PAGE_LIMIT) {
      return;
    }
    offset += CATCH_UP_PAGE_LIMIT;
  }
}
