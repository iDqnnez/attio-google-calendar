import { describe, expect, it } from "vitest";
import { attioTaskDeleted } from "./events";
import { projectTask } from "./functions";

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
});
