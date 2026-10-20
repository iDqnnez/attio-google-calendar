import { describe, expect, it } from "vitest";
import { eventDraft, eventIdForTask, type Task } from "@/projection/decide";
import {
  CATCH_UP_ENQUEUE_CHUNK_SIZE,
  CATCH_UP_PAGE_LIMIT,
  runCatchUpLoader,
  type BoundTask,
  type CalendarEventPage,
  type CalendarEventSnapshot,
} from "./loader";

const CONNECTION = {
  calendarId: "calendar-1",
  timezone: "Europe/Stockholm",
  workspaceSlug: "acme",
};

const TASK_A = "11111111-1111-4111-8111-111111111111";
const TASK_B = "22222222-2222-4222-8222-222222222222";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    content: `Task ${id}`,
    deadline: "2026-10-21",
    isCompleted: false,
    ...overrides,
  };
}

function binding(taskId: string, etag = `"etag-${taskId}"`): BoundTask {
  return {
    taskId,
    calendarId: CONNECTION.calendarId,
    eventId: eventIdForTask(taskId),
    etag,
  };
}

function eventFor(
  projected: Task,
  overrides: Partial<CalendarEventSnapshot> = {},
): CalendarEventSnapshot {
  const draft = eventDraft(
    projected,
    projected.deadline ?? "",
    CONNECTION.timezone,
    CONNECTION.workspaceSlug,
  );
  return {
    id: draft.id,
    etag: `"etag-${projected.id}"`,
    summary: draft.summary,
    description: draft.description,
    start: draft.start,
    end: draft.end,
    ...overrides,
  };
}

async function enqueuedFor(input: {
  tasks: Task[];
  bindings?: BoundTask[];
  events?: CalendarEventSnapshot[];
}): Promise<string[]> {
  const chunks: string[][] = [];
  await runCatchUpLoader({
    connection: CONNECTION,
    async listTasksPage() {
      return input.tasks;
    },
    async listBindingsPage() {
      return input.bindings ?? [];
    },
    async listEventsPage() {
      return { events: input.events ?? [], nextPageToken: null };
    },
    async enqueueChunk(taskIds) {
      chunks.push(taskIds);
    },
  });
  return chunks.flat();
}

describe("runCatchUpLoader", () => {
  it("does not enqueue a Bound Task whose Event already matches it", async () => {
    const open = task(TASK_A);
    const completed = task(TASK_B, { isCompleted: true });

    const enqueued = await enqueuedFor({
      tasks: [open, completed],
      bindings: [binding(TASK_A), binding(TASK_B)],
      events: [eventFor(open), eventFor(completed)],
    });

    expect(enqueued).toEqual([]);
  });

  it("enqueues an Open Qualifying Task that has no Binding", async () => {
    expect(await enqueuedFor({ tasks: [task(TASK_A)] })).toEqual([TASK_A]);
  });

  it("does not enqueue unbound Tasks that are completed or have no Deadline", async () => {
    const enqueued = await enqueuedFor({
      tasks: [
        task(TASK_A, { isCompleted: true }),
        task(TASK_B, { deadline: null }),
      ],
    });

    expect(enqueued).toEqual([]);
  });

  it("enqueues a Bound Task whose Event is missing so it Heals", async () => {
    const enqueued = await enqueuedFor({
      tasks: [task(TASK_A)],
      bindings: [binding(TASK_A)],
    });

    expect(enqueued).toEqual([TASK_A]);
  });

  it("enqueues a Bound Task whose Event was changed on the Calendar", async () => {
    const open = task(TASK_A);

    const enqueued = await enqueuedFor({
      tasks: [open],
      bindings: [binding(TASK_A)],
      events: [eventFor(open, { etag: '"edited-on-calendar"' })],
    });

    expect(enqueued).toEqual([TASK_A]);
  });

  it("enqueues a Bound Task whose content or Deadline changed in Attio", async () => {
    const before = task(TASK_A);
    const beforeB = task(TASK_B);

    const enqueued = await enqueuedFor({
      tasks: [
        { ...before, content: "Renamed" },
        { ...beforeB, deadline: "2026-11-01" },
      ],
      bindings: [binding(TASK_A), binding(TASK_B)],
      events: [eventFor(before), eventFor(beforeB)],
    });

    expect(enqueued).toEqual([TASK_A, TASK_B]);
  });

  it("enqueues a Bound Task whose Deadline was cleared", async () => {
    const before = task(TASK_A);

    const enqueued = await enqueuedFor({
      tasks: [{ ...before, deadline: null }],
      bindings: [binding(TASK_A)],
      events: [eventFor(before)],
    });

    expect(enqueued).toEqual([TASK_A]);
  });

  it("enqueues a Bound Task that Attio no longer lists so its Deletion applies", async () => {
    const deleted = task(TASK_A);

    const enqueued = await enqueuedFor({
      tasks: [],
      bindings: [binding(TASK_A)],
      events: [eventFor(deleted)],
    });

    expect(enqueued).toEqual([TASK_A]);
  });

  it("enqueues a Bound Task whose Binding points at another Calendar", async () => {
    const open = task(TASK_A);

    const enqueued = await enqueuedFor({
      tasks: [open],
      bindings: [{ ...binding(TASK_A), calendarId: "old-calendar" }],
      events: [eventFor(open)],
    });

    expect(enqueued).toEqual([TASK_A]);
  });

  it("pages Tasks, Bindings, and Events, and enqueues unique ids in chunks", async () => {
    const listedTasks: { limit: number; offset: number }[] = [];
    const listedBindings: { limit: number; offset: number }[] = [];
    const eventPageTokens: (string | null)[] = [];
    const chunks: string[][] = [];
    const firstTaskPage = Array.from({ length: CATCH_UP_PAGE_LIMIT }, (_, i) =>
      task(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
    );
    const inSync = task(TASK_A);
    const firstBindingPage = Array.from({ length: CATCH_UP_PAGE_LIMIT }, (_, i) =>
      binding(`bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`),
    );
    const eventPages: Record<string, CalendarEventPage> = {
      first: { events: [], nextPageToken: "second" },
      second: { events: [eventFor(inSync)], nextPageToken: null },
    };

    await runCatchUpLoader({
      connection: CONNECTION,
      async listTasksPage(query) {
        listedTasks.push(query);
        return query.offset === 0 ? firstTaskPage : [inSync];
      },
      async listBindingsPage(query) {
        listedBindings.push(query);
        return query.offset === 0 ? firstBindingPage : [binding(TASK_A)];
      },
      async listEventsPage(pageToken) {
        eventPageTokens.push(pageToken);
        return eventPages[pageToken ?? "first"];
      },
      async enqueueChunk(taskIds) {
        chunks.push(taskIds);
      },
    });

    expect(listedTasks).toEqual([
      { limit: CATCH_UP_PAGE_LIMIT, offset: 0 },
      { limit: CATCH_UP_PAGE_LIMIT, offset: CATCH_UP_PAGE_LIMIT },
    ]);
    expect(listedBindings).toEqual([
      { limit: CATCH_UP_PAGE_LIMIT, offset: 0 },
      { limit: CATCH_UP_PAGE_LIMIT, offset: CATCH_UP_PAGE_LIMIT },
    ]);
    expect(eventPageTokens).toEqual([null, "second"]);
    expect(chunks[0]).toHaveLength(CATCH_UP_ENQUEUE_CHUNK_SIZE);
    expect(chunks.flat()).toHaveLength(CATCH_UP_PAGE_LIMIT * 2);
    expect(chunks.flat()).not.toContain(TASK_A);
    expect(new Set(chunks.flat()).size).toBe(chunks.flat().length);
  });
});
