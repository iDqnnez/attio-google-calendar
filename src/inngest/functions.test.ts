import { describe, expect, it } from "vitest";
import { attioTaskDeleted, backfillRequested, projectionRequested } from "./events";
import { backfillOpenTasks, catchUpTasks, functions, projectTask } from "./functions";

describe("projectTask", () => {
  it("debounces by Task id so rapid updates apply the latest state", () => {
    expect(projectTask.opts.debounce).toEqual({
      key: "event.data.taskId",
      period: "2s",
    });
  });

  it("cancels an in-flight Projection when that Task is deleted", () => {
    const cancel = projectTask.opts.cancelOn?.[0];
    expect(cancel?.event).toBe(attioTaskDeleted);
    expect(cancel?.if).toBe("event.data.taskId == async.data.taskId");
  });

  it("Backfill fans out through the existing Projection worker", () => {
    expect(functions).toEqual(
      expect.arrayContaining([projectTask, backfillOpenTasks]),
    );
    expect(backfillOpenTasks.opts.triggers).toEqual([backfillRequested]);
    expect(projectTask.opts.triggers).toEqual(
      expect.arrayContaining([projectionRequested]),
    );
  });

  it("Catch-up runs hourly and fans out through the existing Projection worker", () => {
    expect(functions).toEqual(
      expect.arrayContaining([projectTask, catchUpTasks]),
    );
    expect(catchUpTasks.opts.triggers).toEqual([{ cron: "0 * * * *" }]);
    expect(projectTask.opts.triggers).toEqual(
      expect.arrayContaining([projectionRequested]),
    );
  });
});
