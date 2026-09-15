import { RetryAfterError } from "inngest";
import { GoogleHttpError } from "@/google/errors";
import {
  decideProjection,
  eventIdForTask,
  type EventDraft,
  type ProjectionDecision,
  type Task,
} from "./decide";

export type BindingRecord = {
  taskId: string;
  calendarId: string;
  eventId: string;
  etag: string;
};

export type BindingStore = {
  findByTaskId(taskId: string): Promise<BindingRecord | null>;
  save(binding: BindingRecord): Promise<void>;
  deleteByTaskId(taskId: string): Promise<void>;
};

export type AttioTasks = {
  get(taskId: string): Promise<Task | null>;
};

export type WrittenEvent = {
  id: string;
  etag: string;
  status?: string;
};

export type CalendarEvents = {
  get(calendarId: string, eventId: string): Promise<WrittenEvent | null>;
  insert(calendarId: string, event: EventDraft): Promise<WrittenEvent>;
  update(
    calendarId: string,
    event: EventDraft,
    etag: string,
  ): Promise<WrittenEvent>;
  delete(calendarId: string, eventId: string): Promise<void>;
};

export type ProjectionPlan = {
  taskId: string;
  calendarId: string;
  eventId: string;
  existingEtag: string | null;
  decision: ProjectionDecision;
};

export type ProjectionWrite = WrittenEvent | "deleted" | null;

export async function projectOneTask(input: {
  taskId: string;
  connection: {
    calendarId: string;
    timezone: string;
    workspaceSlug: string;
  };
  tasks: AttioTasks;
  bindings: BindingStore;
  events: CalendarEvents;
}): Promise<void> {
  const task = await input.tasks.get(input.taskId);
  const plan = await planProjection({
    taskId: input.taskId,
    task,
    connection: input.connection,
    bindings: input.bindings,
    events: input.events,
  });
  const written = await applyProjectionWrite(plan, input.events);
  await persistProjection(plan, written, input.bindings);
}

export async function planProjection(input: {
  taskId: string;
  task: Task | null;
  connection: {
    calendarId: string;
    timezone: string;
    workspaceSlug: string;
  };
  bindings: BindingStore;
  events: CalendarEvents;
}): Promise<ProjectionPlan> {
  const binding = await input.bindings.findByTaskId(input.taskId);
  const eventId = binding?.eventId ?? eventIdForTask(input.taskId);
  const existing = await googleWrite(() =>
    input.events.get(input.connection.calendarId, eventId),
  );
  const eventPresent = existing != null && existing.status !== "cancelled";

  return {
    taskId: input.taskId,
    calendarId: input.connection.calendarId,
    eventId,
    existingEtag: existing?.etag ?? binding?.etag ?? null,
    decision: decideProjection({
      task: input.task,
      binding,
      eventPresent,
      connectionTimezone: input.connection.timezone,
      workspaceSlug: input.connection.workspaceSlug,
    }),
  };
}

export async function applyProjectionWrite(
  plan: ProjectionPlan,
  events: CalendarEvents,
): Promise<ProjectionWrite> {
  const { decision } = plan;
  if (decision.action === "noop") {
    return null;
  }
  if (decision.action === "create") {
    return insertOrHeal(events, plan.calendarId, decision.event);
  }
  if (decision.action === "delete") {
    await deleteEvent(events, plan.calendarId, plan.eventId);
    return "deleted";
  }
  return updateFromEtag(
    events,
    plan.calendarId,
    decision.event,
    plan.existingEtag,
  );
}

export async function persistProjection(
  plan: ProjectionPlan,
  written: ProjectionWrite,
  bindings: BindingStore,
): Promise<void> {
  if (written === "deleted") {
    await bindings.deleteByTaskId(plan.taskId);
    return;
  }
  if (written == null) {
    return;
  }
  await bindings.save({
    taskId: plan.taskId,
    calendarId: plan.calendarId,
    eventId: written.id,
    etag: written.etag,
  });
}

async function insertOrHeal(
  events: CalendarEvents,
  calendarId: string,
  event: EventDraft,
): Promise<WrittenEvent> {
  try {
    return await googleWrite(() => events.insert(calendarId, event));
  } catch (error) {
    if (!(error instanceof GoogleHttpError) || error.status !== 409) {
      throw error;
    }
    const existing = await googleWrite(() => events.get(calendarId, event.id));
    if (existing == null) {
      throw error;
    }
    return updateFromEtag(events, calendarId, event, existing.etag);
  }
}

async function deleteEvent(
  events: CalendarEvents,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await googleWrite(() => events.delete(calendarId, eventId));
  } catch (error) {
    if (
      error instanceof GoogleHttpError &&
      (error.status === 404 || error.status === 410)
    ) {
      return;
    }
    throw error;
  }
}

async function updateFromEtag(
  events: CalendarEvents,
  calendarId: string,
  event: EventDraft,
  etag: string | null,
): Promise<WrittenEvent> {
  const currentEtag =
    etag ??
    (await googleWrite(() => events.get(calendarId, event.id)))?.etag;
  if (currentEtag == null) {
    return insertOrHeal(events, calendarId, event);
  }

  try {
    return await googleWrite(() =>
      events.update(calendarId, event, currentEtag),
    );
  } catch (error) {
    if (!(error instanceof GoogleHttpError) || error.status !== 412) {
      if (error instanceof GoogleHttpError && error.status === 404) {
        return insertOrHeal(events, calendarId, event);
      }
      throw error;
    }
    const fresh = await googleWrite(() => events.get(calendarId, event.id));
    if (fresh == null) {
      return insertOrHeal(events, calendarId, event);
    }
    return googleWrite(() => events.update(calendarId, event, fresh.etag));
  }
}

async function googleWrite<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (error instanceof GoogleHttpError && error.status === 429) {
      throw new RetryAfterError(
        "Google rate limited",
        retryAfterFromHeader(error.retryAfter),
        { cause: error },
      );
    }
    throw error;
  }
}

function retryAfterFromHeader(header: string | null): number | Date {
  if (header == null || header === "") {
    return 60_000;
  }
  if (/^\d+$/.test(header)) {
    return Number(header) * 1000;
  }
  return new Date(header);
}
