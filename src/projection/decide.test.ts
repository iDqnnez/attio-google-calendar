import { describe, expect, it } from "vitest";
import { decideProjection } from "./decide";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "11111111111141118111111111111111";
const TIMEZONE = "Europe/Stockholm";
const WORKSPACE = "acme";

function task(
  overrides: Partial<{
    id: string;
    content: string;
    deadline: string | null;
    isCompleted: boolean;
  }> = {},
) {
  return {
    id: TASK_ID,
    content: "Follow up on current software solutions",
    deadline: "2023-01-01",
    isCompleted: false,
    ...overrides,
  };
}

const binding = { taskId: TASK_ID, eventId: EVENT_ID };

function eventDraft(start: string, end: string) {
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

describe("decideProjection", () => {
  it.each([
    {
      name: "adding a Deadline to a Task with no Binding creates an all-day Event",
      task: task(),
      binding: null,
      eventPresent: false,
      expected: {
        action: "create",
        event: eventDraft("2023-01-01", "2023-01-02"),
      },
    },
    {
      name: "Task with no Deadline and no Binding is a noop",
      task: task({ deadline: null }),
      binding: null,
      eventPresent: false,
      expected: { action: "noop" },
    },
    {
      name: "clearing a Deadline deletes the Event",
      task: task({ deadline: null }),
      binding,
      eventPresent: true,
      expected: { action: "delete" },
    },
    {
      name: "clearing a Deadline ends the Binding even if the Event is already missing",
      task: task({ deadline: null }),
      binding,
      eventPresent: false,
      expected: { action: "delete" },
    },
    {
      name: "Deletion of a Bound Task deletes the Event",
      task: null,
      binding,
      eventPresent: true,
      expected: { action: "delete" },
    },
    {
      name: "Deletion with no Binding is a noop",
      task: null,
      binding: null,
      eventPresent: false,
      expected: { action: "noop" },
    },
    {
      name: "a missing Task with an Event present but no Binding is a noop",
      task: null,
      binding: null,
      eventPresent: true,
      expected: { action: "noop" },
    },
    {
      name: "a Task with no Deadline, no Binding, and an Event present is a noop",
      task: task({ deadline: null }),
      binding: null,
      eventPresent: true,
      expected: { action: "noop" },
    },
    {
      name: "a Qualifying Task with Binding and Event present is updated",
      task: task(),
      binding,
      eventPresent: true,
      expected: {
        action: "update",
        event: eventDraft("2023-01-01", "2023-01-02"),
      },
    },
    {
      name: "a Qualifying Task with an Event present and no Binding is updated",
      task: task(),
      binding: null,
      eventPresent: true,
      expected: {
        action: "update",
        event: eventDraft("2023-01-01", "2023-01-02"),
      },
    },
    {
      name: "moving a Deadline updates the Event to the new civil date",
      task: task({ deadline: "2023-06-15" }),
      binding,
      eventPresent: true,
      expected: {
        action: "update",
        event: eventDraft("2023-06-15", "2023-06-16"),
      },
    },
    {
      name: "Heal creates the Event again with the same id when Binding exists and the Event is missing",
      task: task(),
      binding,
      eventPresent: false,
      expected: {
        action: "create",
        event: eventDraft("2023-01-01", "2023-01-02"),
      },
    },
    {
      name: "Completion updates the Event instead of deleting it",
      task: task({ isCompleted: true }),
      binding,
      eventPresent: true,
      expected: {
        action: "update",
        event: eventDraft("2023-01-01", "2023-01-02"),
      },
    },
    {
      name: "a completed Qualifying Task with no Binding still creates",
      task: task({ isCompleted: true }),
      binding: null,
      eventPresent: false,
      expected: {
        action: "create",
        event: eventDraft("2023-01-01", "2023-01-02"),
      },
    },
    {
      name: "a date-only Deadline is that civil date even in US Pacific",
      task: task(),
      binding: null,
      eventPresent: false,
      connectionTimezone: "America/Los_Angeles",
      expected: {
        action: "create",
        event: eventDraft("2023-01-01", "2023-01-02"),
      },
    },
    {
      name: "a datetime Deadline uses the civil date in Europe/Stockholm",
      task: task({ deadline: "2026-09-16T00:00:00Z" }),
      binding: null,
      eventPresent: false,
      connectionTimezone: "Europe/Stockholm",
      expected: {
        action: "create",
        event: eventDraft("2026-09-16", "2026-09-17"),
      },
    },
    {
      name: "a datetime Deadline uses the civil date in America/Los_Angeles",
      task: task({ deadline: "2026-09-16T00:00:00Z" }),
      binding: null,
      eventPresent: false,
      connectionTimezone: "America/Los_Angeles",
      expected: {
        action: "create",
        event: eventDraft("2026-09-15", "2026-09-16"),
      },
    },
  ])(
    "$name",
    ({
      task,
      binding: existingBinding,
      eventPresent,
      expected,
      connectionTimezone = TIMEZONE,
    }) => {
      expect(
        decideProjection({
          task,
          binding: existingBinding,
          eventPresent,
          connectionTimezone,
          workspaceSlug: WORKSPACE,
        }),
      ).toEqual(expected);
    },
  );
});
