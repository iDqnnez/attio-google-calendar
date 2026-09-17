export type Task = {
  id: string;
  content: string;
  deadline: string | null;
  isCompleted: boolean;
};

export type Binding = {
  taskId: string;
  eventId: string;
};

export type EventDraft = {
  id: string;
  summary: string;
  description: string;
  start: { date: string };
  end: { date: string };
  extendedProperties: { private: { attioTaskId: string } };
};

export type ProjectionDecision =
  | { action: "create" | "update"; event: EventDraft }
  | { action: "delete" }
  | { action: "noop" };

export function eventIdForTask(taskId: string): string {
  return taskId.replaceAll("-", "");
}

export function decideProjection(input: {
  task: Task | null;
  binding: Binding | null;
  eventPresent: boolean;
  connectionTimezone: string;
  workspaceSlug: string;
}): ProjectionDecision {
  const { task, binding, eventPresent, connectionTimezone, workspaceSlug } =
    input;
  if (task == null || task.deadline == null) {
    if (binding != null || eventPresent) {
      return { action: "delete" };
    }
    return { action: "noop" };
  }

  return {
    action: eventPresent ? "update" : "create",
    event: eventDraft(task, task.deadline, connectionTimezone, workspaceSlug),
  };
}

function eventDraft(
  task: Task,
  deadline: string,
  connectionTimezone: string,
  workspaceSlug: string,
): EventDraft {
  const start = civilDate(deadline, connectionTimezone);

  return {
    id: eventIdForTask(task.id),
    summary: task.content,
    description: taskUrl(workspaceSlug, task.id),
    start: { date: start },
    end: { date: nextDay(start) },
    extendedProperties: { private: { attioTaskId: task.id } },
  };
}

function taskUrl(workspaceSlug: string, taskId: string): string {
  return `https://app.attio.com/${workspaceSlug}/tasks?id=${taskId}&command-menu-page=task`;
}

function civilDate(deadline: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return deadline;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(deadline));

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
