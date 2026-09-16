import { cron, NonRetriableError } from "inngest";
import { attioTasks } from "@/attio/tasks";
import { runCatchUpLoader } from "@/catch-up/loader";
import { runBackfillLoader } from "@/connect/backfill";
import { listBoundTaskIds as loadBoundTaskIds, prismaBindingStore } from "@/db/bindings";
import { findReadyConnection } from "@/db/connections";
import { attioEnv, googleOAuthEnv } from "@/env";
import { googleCalendarEvents } from "@/google/events";
import { refreshGoogleAccessToken } from "@/google/oauth";
import {
  applyProjectionWrite,
  persistProjection,
  planProjection,
} from "@/projection/project";
import { inngest } from "./client";
import {
  attioTaskCreated,
  attioTaskDeleted,
  attioTaskUpdated,
  backfillRequested,
  projectionRequested,
} from "./events";

export const projectTask = inngest.createFunction(
  {
    id: "project-task",
    triggers: [
      attioTaskCreated,
      attioTaskUpdated,
      attioTaskDeleted,
      projectionRequested,
    ],
    throttle: {
      limit: 5,
      period: "1s",
    },
    debounce: {
      key: "event.data.taskId",
      period: "2s",
    },
    cancelOn: [
      {
        event: attioTaskDeleted,
        if: "event.data.taskId == async.data.taskId",
      },
    ],
    concurrency: [
      {
        limit: 1,
        key: '"calendar"',
      },
    ],
  },
  async ({ event, step }) => {
    const taskId = event.data.taskId;

    const connection = await step.run("load-connection", async () => {
      const ready = await findReadyConnection();
      if (ready == null) {
        throw new NonRetriableError("Connection is not ready");
      }
      return {
        calendarId: ready.calendarId,
        workspaceSlug: ready.workspaceSlug,
        timezone: ready.timezone,
      };
    });

    const task = await step.run("fetch-task", () =>
      attioTasks(attioEnv().apiToken).get(taskId),
    );
    const plan = await step.run("decide", async () =>
      planProjection({
        taskId,
        task,
        connection,
        bindings: prismaBindingStore,
        events: await googleEvents(),
      }),
    );
    const written = await step.run("google-write", async () =>
      applyProjectionWrite(plan, await googleEvents()),
    );
    await step.run("persist-binding", () =>
      persistProjection(plan, written, prismaBindingStore),
    );

    return { taskId, action: plan.decision.action };
  },
);

export const backfillOpenTasks = inngest.createFunction(
  {
    id: "backfill-open-tasks",
    triggers: [backfillRequested],
  },
  async ({ step }) => {
    const tasks = attioTasks(attioEnv().apiToken);
    return runBackfillLoader({
      listOpenPage: (query) =>
        step.run("list-open-tasks", () => tasks.listOpen(query)),
      enqueueChunk: async (taskIds) => {
        await step.sendEvent(
          "enqueue-projections",
          taskIds.map((taskId) => projectionRequested.create({ taskId })),
        );
      },
    });
  },
);

export const catchUpTasks = inngest.createFunction(
  {
    id: "catch-up-tasks",
    triggers: [cron("0 * * * *")],
  },
  async ({ step }) => {
    const tasks = attioTasks(attioEnv().apiToken);
    return runCatchUpLoader({
      listOpenPage: (query) =>
        step.run("list-open-tasks", () => tasks.listOpen(query)),
      listBoundTaskIds: (query) =>
        step.run("list-bound-tasks", () => loadBoundTaskIds(query)),
      enqueueChunk: async (taskIds) => {
        await step.sendEvent(
          "enqueue-projections",
          taskIds.map((taskId) => projectionRequested.create({ taskId })),
        );
      },
    });
  },
);

async function googleEvents() {
  const ready = await findReadyConnection();
  if (ready == null) {
    throw new NonRetriableError("Connection is not ready");
  }
  const oauth = googleOAuthEnv();
  const accessToken = await refreshGoogleAccessToken({
    refreshToken: ready.googleRefreshToken,
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
  });
  return googleCalendarEvents(accessToken);
}

export const functions = [projectTask, backfillOpenTasks, catchUpTasks];
