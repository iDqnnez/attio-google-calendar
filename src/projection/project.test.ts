import { RetryAfterError } from "inngest";
import { describe, expect, it } from "vitest";
import { GoogleHttpError } from "@/google/errors";
import {
  projectOneTask,
  type AttioTasks,
  type BindingRecord,
  type BindingStore,
  type CalendarEvents,
  type WrittenEvent,
} from "./project";
import type { EventDraft, Task } from "./decide";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "11111111111141118111111111111111";
const CALENDAR_ID = "calendar-1";
const TIMEZONE = "Europe/Stockholm";
const WORKSPACE = "acme";

const connection = {
  calendarId: CALENDAR_ID,
  timezone: TIMEZONE,
  workspaceSlug: WORKSPACE,
};

function qualifyingTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    content: "Follow up on current software solutions",
    deadline: "2023-01-01",
    isCompleted: false,
    ...overrides,
  };
}

function expectedDraft(start: string, end: string): EventDraft {
  return {
    id: EVENT_ID,
    summary: "Follow up on current software solutions",
    description:
      "https://app.attio.com/acme/tasks?id=11111111-1111-4111-8111-111111111111&command-menu-page=task",
    start: { date: start },
    end: { date: end },
    extendedProperties: { private: { attioTaskId: TASK_ID } },
  };
}

function memoryBindings(seed: BindingRecord[] = []): BindingStore & {
  rows: Map<string, BindingRecord>;
} {
  const rows = new Map(
    seed.map((binding) => [binding.taskId, { ...binding }]),
  );
  return {
    rows,
    async findByTaskId(taskId) {
      const row = rows.get(taskId);
      return row == null ? null : { ...row };
    },
    async save(binding) {
      rows.set(binding.taskId, { ...binding });
    },
    async deleteByTaskId(taskId) {
      rows.delete(taskId);
    },
  };
}

function tasksOf(task: Task | null): AttioTasks {
  return {
    async get(taskId) {
      if (task == null || task.id !== taskId) {
        return null;
      }
      return task;
    },
  };
}

function memoryEvents(seed: WrittenEvent[] = []) {
  const byId = new Map(seed.map((event) => [event.id, { ...event }]));
  const inserted: EventDraft[] = [];
  const updated: { event: EventDraft; etag: string }[] = [];
  const deleted: string[] = [];
  let etagSeq = seed.length;

  const events: CalendarEvents = {
    async get(_calendarId, eventId) {
      return byId.get(eventId) ?? null;
    },
    async insert(_calendarId, event) {
      inserted.push(event);
      if (byId.has(event.id)) {
        throw new GoogleHttpError(409);
      }
      etagSeq += 1;
      const written: WrittenEvent = { id: event.id, etag: `etag-${etagSeq}` };
      byId.set(event.id, written);
      return written;
    },
    async update(_calendarId, event, etag) {
      const existing = byId.get(event.id);
      if (existing == null) {
        throw new GoogleHttpError(404);
      }
      if (existing.etag !== etag) {
        throw new GoogleHttpError(412);
      }
      etagSeq += 1;
      const written: WrittenEvent = { id: event.id, etag: `etag-${etagSeq}` };
      byId.set(event.id, written);
      updated.push({ event, etag });
      return written;
    },
    async delete(_calendarId, eventId) {
      deleted.push(eventId);
      byId.delete(eventId);
    },
  };

  return { events, byId, inserted, updated, deleted };
}

describe("projectOneTask", () => {
  it("a Qualifying Task becomes an all-day Event with title, Task URL, and private Task id", async () => {
    const bindings = memoryBindings();
    const calendar = memoryEvents();

    await projectOneTask({
      taskId: TASK_ID,
      connection,
      tasks: tasksOf(qualifyingTask()),
      bindings,
      events: calendar.events,
    });

    expect(calendar.inserted).toEqual([expectedDraft("2023-01-01", "2023-01-02")]);
    expect(calendar.updated).toEqual([]);
    expect(await bindings.findByTaskId(TASK_ID)).toEqual({
      taskId: TASK_ID,
      calendarId: CALENDAR_ID,
      eventId: EVENT_ID,
      etag: "etag-1",
    });
  });

  it("a Task with no Deadline creates no Event", async () => {
    const bindings = memoryBindings();
    const calendar = memoryEvents();

    await projectOneTask({
      taskId: TASK_ID,
      connection,
      tasks: tasksOf(qualifyingTask({ deadline: null })),
      bindings,
      events: calendar.events,
    });

    expect(calendar.inserted).toEqual([]);
    expect(calendar.updated).toEqual([]);
    expect(calendar.deleted).toEqual([]);
    expect(await bindings.findByTaskId(TASK_ID)).toBeNull();
  });

  it("clearing a Deadline deletes the Event and ends the Binding", async () => {
    const bindings = memoryBindings([
      {
        taskId: TASK_ID,
        calendarId: CALENDAR_ID,
        eventId: EVENT_ID,
        etag: "etag-1",
      },
    ]);
    const calendar = memoryEvents([
      { id: EVENT_ID, etag: "etag-1" },
    ]);

    await projectOneTask({
      taskId: TASK_ID,
      connection,
      tasks: tasksOf(qualifyingTask({ deadline: null })),
      bindings,
      events: calendar.events,
    });

    expect(calendar.deleted).toEqual([EVENT_ID]);
    expect(await bindings.findByTaskId(TASK_ID)).toBeNull();
  });

  it("Completion updates the Event in place without a title prefix or transparency change", async () => {
    const bindings = memoryBindings([
      {
        taskId: TASK_ID,
        calendarId: CALENDAR_ID,
        eventId: EVENT_ID,
        etag: "etag-1",
      },
    ]);
    const calendar = memoryEvents([{ id: EVENT_ID, etag: "etag-1" }]);

    await projectOneTask({
      taskId: TASK_ID,
      connection,
      tasks: tasksOf(qualifyingTask({ isCompleted: true })),
      bindings,
      events: calendar.events,
    });

    expect(calendar.inserted).toEqual([]);
    expect(calendar.updated).toEqual([
      { event: expectedDraft("2023-01-01", "2023-01-02"), etag: "etag-1" },
    ]);
    expect(calendar.updated[0]?.event.summary).toBe(
      "Follow up on current software solutions",
    );
    expect(calendar.updated[0]?.event).not.toHaveProperty("transparency");
    expect(await bindings.findByTaskId(TASK_ID)).toEqual({
      taskId: TASK_ID,
      calendarId: CALENDAR_ID,
      eventId: EVENT_ID,
      etag: "etag-2",
    });
  });

  it("Deletion (Attio 404) deletes the Event and ends the Binding", async () => {
    const bindings = memoryBindings([
      {
        taskId: TASK_ID,
        calendarId: CALENDAR_ID,
        eventId: EVENT_ID,
        etag: "etag-1",
      },
    ]);
    const calendar = memoryEvents([{ id: EVENT_ID, etag: "etag-1" }]);

    await projectOneTask({
      taskId: TASK_ID,
      connection,
      tasks: tasksOf(null),
      bindings,
      events: calendar.events,
    });

    expect(calendar.deleted).toEqual([EVENT_ID]);
    expect(await bindings.findByTaskId(TASK_ID)).toBeNull();
  });

  it("Heal inserts the same Event id when the Binding exists and the Event is missing", async () => {
    const bindings = memoryBindings([
      {
        taskId: TASK_ID,
        calendarId: CALENDAR_ID,
        eventId: EVENT_ID,
        etag: "etag-stale",
      },
    ]);
    const calendar = memoryEvents();

    await projectOneTask({
      taskId: TASK_ID,
      connection,
      tasks: tasksOf(qualifyingTask()),
      bindings,
      events: calendar.events,
    });

    expect(calendar.inserted).toEqual([expectedDraft("2023-01-01", "2023-01-02")]);
    expect(calendar.inserted[0]?.id).toBe(EVENT_ID);
    expect(await bindings.findByTaskId(TASK_ID)).toEqual({
      taskId: TASK_ID,
      calendarId: CALENDAR_ID,
      eventId: EVENT_ID,
      etag: "etag-1",
    });
  });

  it("Heal updates the existing Event when insert returns 409, without a second Event id", async () => {
    const bindings = memoryBindings([
      {
        taskId: TASK_ID,
        calendarId: CALENDAR_ID,
        eventId: EVENT_ID,
        etag: "etag-stale",
      },
    ]);
    const calendar = memoryEvents([
      { id: EVENT_ID, etag: "etag-cancelled", status: "cancelled" },
    ]);

    await projectOneTask({
      taskId: TASK_ID,
      connection,
      tasks: tasksOf(qualifyingTask()),
      bindings,
      events: calendar.events,
    });

    expect(calendar.inserted).toEqual([expectedDraft("2023-01-01", "2023-01-02")]);
    expect(calendar.updated).toEqual([
      {
        event: expectedDraft("2023-01-01", "2023-01-02"),
        etag: "etag-cancelled",
      },
    ]);
    expect(calendar.byId.size).toBe(1);
    expect(calendar.byId.get(EVENT_ID)?.id).toBe(EVENT_ID);
    expect(await bindings.findByTaskId(TASK_ID)).toEqual({
      taskId: TASK_ID,
      calendarId: CALENDAR_ID,
      eventId: EVENT_ID,
      etag: "etag-2",
    });
  });

  it("a stale etag 412 refetches and retries the update", async () => {
    const bindings = memoryBindings([
      {
        taskId: TASK_ID,
        calendarId: CALENDAR_ID,
        eventId: EVENT_ID,
        etag: "etag-stale",
      },
    ]);
    const draft = expectedDraft("2023-01-01", "2023-01-02");
    let gets = 0;
    const updated: { event: EventDraft; etag: string }[] = [];
    const events: CalendarEvents = {
      async get() {
        gets += 1;
        if (gets === 1) {
          return { id: EVENT_ID, etag: "etag-stale" };
        }
        return { id: EVENT_ID, etag: "etag-fresh" };
      },
      async insert() {
        throw new Error("insert should not run");
      },
      async update(_calendarId, event, etag) {
        updated.push({ event, etag });
        if (etag === "etag-stale") {
          throw new GoogleHttpError(412);
        }
        return { id: EVENT_ID, etag: "etag-next" };
      },
      async delete() {
        throw new Error("delete should not run");
      },
    };

    await projectOneTask({
      taskId: TASK_ID,
      connection,
      tasks: tasksOf(qualifyingTask()),
      bindings,
      events,
    });

    expect(updated).toEqual([
      { event: draft, etag: "etag-stale" },
      { event: draft, etag: "etag-fresh" },
    ]);
    expect(await bindings.findByTaskId(TASK_ID)).toEqual({
      taskId: TASK_ID,
      calendarId: CALENDAR_ID,
      eventId: EVENT_ID,
      etag: "etag-next",
    });
  });

  it("Google 429 retries after Retry-After", async () => {
    const bindings = memoryBindings();
    const events: CalendarEvents = {
      async get() {
        return null;
      },
      async insert() {
        throw new GoogleHttpError(429, "120");
      },
      async update() {
        throw new Error("update should not run");
      },
      async delete() {
        throw new Error("delete should not run");
      },
    };

    const error = await projectOneTask({
      taskId: TASK_ID,
      connection,
      tasks: tasksOf(qualifyingTask()),
      bindings,
      events,
    }).then(
      () => {
        throw new Error("expected RetryAfterError");
      },
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(RetryAfterError);
    expect(error).toMatchObject({ retryAfter: "120" });
    expect(await bindings.findByTaskId(TASK_ID)).toBeNull();
  });

  it("Heal inserts the same Event id when update finds the Event missing", async () => {
    const bindings = memoryBindings([
      {
        taskId: TASK_ID,
        calendarId: CALENDAR_ID,
        eventId: EVENT_ID,
        etag: "etag-1",
      },
    ]);
    const inserted: EventDraft[] = [];
    const events: CalendarEvents = {
      async get() {
        return { id: EVENT_ID, etag: "etag-1" };
      },
      async insert(_calendarId, event) {
        inserted.push(event);
        return { id: EVENT_ID, etag: "etag-healed" };
      },
      async update() {
        throw new GoogleHttpError(404);
      },
      async delete() {
        throw new Error("delete should not run");
      },
    };

    await projectOneTask({
      taskId: TASK_ID,
      connection,
      tasks: tasksOf(qualifyingTask()),
      bindings,
      events,
    });

    expect(inserted).toEqual([expectedDraft("2023-01-01", "2023-01-02")]);
    expect(await bindings.findByTaskId(TASK_ID)).toEqual({
      taskId: TASK_ID,
      calendarId: CALENDAR_ID,
      eventId: EVENT_ID,
      etag: "etag-healed",
    });
  });
});
