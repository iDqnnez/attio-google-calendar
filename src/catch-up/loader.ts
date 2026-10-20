import { eventDraft, type EventDraft, type Task } from "@/projection/decide";

export const CATCH_UP_PAGE_LIMIT = 500;
export const CATCH_UP_ENQUEUE_CHUNK_SIZE = 100;

export type BoundTask = {
  taskId: string;
  calendarId: string;
  eventId: string;
  etag: string;
};

export type CalendarEventSnapshot = {
  id: string;
  etag: string;
  summary: string;
  description: string;
  start: { date: string | null };
  end: { date: string | null };
};

export type CalendarEventPage = {
  events: CalendarEventSnapshot[];
  nextPageToken: string | null;
};

type PageQuery = { limit: number; offset: number };

// Enqueues only Tasks whose Event may have drifted from Attio or been touched
// on the Calendar; the Projection worker still re-reads both sides.
export async function runCatchUpLoader(input: {
  connection: {
    calendarId: string;
    timezone: string;
    workspaceSlug: string;
  };
  listTasksPage: (query: PageQuery) => Promise<Task[]>;
  listBindingsPage: (query: PageQuery) => Promise<BoundTask[]>;
  listEventsPage: (pageToken: string | null) => Promise<CalendarEventPage>;
  enqueueChunk: (taskIds: string[]) => Promise<void>;
}): Promise<{ enqueued: number }> {
  const bindings = new Map<string, BoundTask>();
  await forEachPage(input.listBindingsPage, (binding) => {
    bindings.set(binding.taskId, binding);
  });

  const events = new Map<string, CalendarEventSnapshot>();
  let pageToken: string | null = null;
  do {
    const page = await input.listEventsPage(pageToken);
    for (const event of page.events) {
      events.set(event.id, event);
    }
    pageToken = page.nextPageToken;
  } while (pageToken != null);

  const listed = new Set<string>();
  const taskIds = new Set<string>();
  await forEachPage(input.listTasksPage, (task) => {
    listed.add(task.id);
    if (needsProjection(task, bindings.get(task.id), events, input.connection)) {
      taskIds.add(task.id);
    }
  });
  for (const taskId of bindings.keys()) {
    if (!listed.has(taskId)) {
      taskIds.add(taskId);
    }
  }

  const ids = [...taskIds];
  for (let i = 0; i < ids.length; i += CATCH_UP_ENQUEUE_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CATCH_UP_ENQUEUE_CHUNK_SIZE);
    await input.enqueueChunk(chunk);
  }
  return { enqueued: ids.length };
}

function needsProjection(
  task: Task,
  binding: BoundTask | undefined,
  events: Map<string, CalendarEventSnapshot>,
  connection: { calendarId: string; timezone: string; workspaceSlug: string },
): boolean {
  if (binding == null) {
    return !task.isCompleted && task.deadline != null;
  }
  if (task.deadline == null || binding.calendarId !== connection.calendarId) {
    return true;
  }
  const event = events.get(binding.eventId);
  if (event == null || event.etag !== binding.etag) {
    return true;
  }
  return !eventMatchesDraft(
    event,
    eventDraft(task, task.deadline, connection.timezone, connection.workspaceSlug),
  );
}

function eventMatchesDraft(
  event: CalendarEventSnapshot,
  draft: EventDraft,
): boolean {
  return (
    event.summary === draft.summary &&
    event.description === draft.description &&
    event.start.date === draft.start.date &&
    event.end.date === draft.end.date
  );
}

async function forEachPage<T>(
  listPage: (query: PageQuery) => Promise<T[]>,
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
