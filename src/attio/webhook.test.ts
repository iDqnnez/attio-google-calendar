import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { receiveAttioWebhook } from "./webhook";

const SECRET = "webhook-secret";
const TASK_ID = "649e34f4-c39a-4f4d-99ef-48a36bef8f04";
const IDEMPOTENCY_KEY = "delivery-1";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function taskBody(eventType: string, taskId = TASK_ID): string {
  return JSON.stringify({
    webhook_id: "23e42eaf-323a-41da-b5bb-fd67eebda553",
    events: [
      {
        event_type: eventType,
        id: {
          workspace_id: "14beef7a-99f7-4534-a87e-70b564330a4c",
          task_id: taskId,
        },
        actor: {
          type: "workspace-member",
          id: "50cf242c-7fa3-4cad-87d0-75b1af71c57b",
        },
      },
    ],
  });
}

function memorySender() {
  const sent: unknown[] = [];
  return {
    sent,
    async send(events: unknown) {
      sent.push(events);
    },
  };
}

describe("receiveAttioWebhook", () => {
  it("invalid Attio-Signature returns 401 and does not enqueue", async () => {
    const events = memorySender();
    const rawBody = taskBody("task.created");

    const result = await receiveAttioWebhook({
      rawBody,
      signature: sign(rawBody, "wrong-secret"),
      idempotencyKey: IDEMPOTENCY_KEY,
      secret: SECRET,
      send: events.send,
    });

    expect(result).toEqual({ status: 401 });
    expect(events.sent).toEqual([]);
  });

  it("missing Attio-Signature returns 401 and does not enqueue", async () => {
    const events = memorySender();
    const rawBody = taskBody("task.created");

    const result = await receiveAttioWebhook({
      rawBody,
      signature: null,
      idempotencyKey: IDEMPOTENCY_KEY,
      secret: SECRET,
      send: events.send,
    });

    expect(result).toEqual({ status: 401 });
    expect(events.sent).toEqual([]);
  });

  it("valid task.created enqueues Projection with the Task id and returns 2xx", async () => {
    const events = memorySender();
    const rawBody = taskBody("task.created");

    const result = await receiveAttioWebhook({
      rawBody,
      signature: sign(rawBody),
      idempotencyKey: IDEMPOTENCY_KEY,
      secret: SECRET,
      send: events.send,
    });

    expect(result.status).toBeGreaterThanOrEqual(200);
    expect(result.status).toBeLessThan(300);
    expect(events.sent).toEqual([
      [
        expect.objectContaining({
          name: "attio/task.created",
          data: { taskId: TASK_ID },
        }),
      ],
    ]);
  });

  it.each([
    { attioType: "task.updated", inngestName: "attio/task.updated" },
    { attioType: "task.deleted", inngestName: "attio/task.deleted" },
  ] as const)(
    "valid $attioType enqueues $inngestName with the Task id and returns 2xx",
    async ({ attioType, inngestName }) => {
      const events = memorySender();
      const rawBody = taskBody(attioType);

      const result = await receiveAttioWebhook({
        rawBody,
        signature: sign(rawBody),
        idempotencyKey: IDEMPOTENCY_KEY,
        secret: SECRET,
        send: events.send,
      });

      expect(result.status).toBeGreaterThanOrEqual(200);
      expect(result.status).toBeLessThan(300);
      expect(events.sent).toEqual([
        [
          expect.objectContaining({
            name: inngestName,
            data: { taskId: TASK_ID },
          }),
        ],
      ]);
    },
  );

  it("event id includes the event type and Idempotency-Key so duplicate deliveries collapse", async () => {
    const events = memorySender();
    const rawBody = taskBody("task.updated");
    const input = {
      rawBody,
      signature: sign(rawBody),
      idempotencyKey: IDEMPOTENCY_KEY,
      secret: SECRET,
      send: events.send,
    };

    await receiveAttioWebhook(input);
    await receiveAttioWebhook(input);

    const first = events.sent[0] as { id?: string; name: string }[];
    const second = events.sent[1] as { id?: string; name: string }[];
    expect(first[0]?.id).toBe("attio/task.updated:delivery-1");
    expect(second[0]?.id).toBe(first[0]?.id);
  });

  it("same Idempotency-Key on a different event type gets a different event id", async () => {
    const events = memorySender();
    const created = taskBody("task.created");
    const updated = taskBody("task.updated");

    await receiveAttioWebhook({
      rawBody: created,
      signature: sign(created),
      idempotencyKey: IDEMPOTENCY_KEY,
      secret: SECRET,
      send: events.send,
    });
    await receiveAttioWebhook({
      rawBody: updated,
      signature: sign(updated),
      idempotencyKey: IDEMPOTENCY_KEY,
      secret: SECRET,
      send: events.send,
    });

    const first = events.sent[0] as { id?: string }[];
    const second = events.sent[1] as { id?: string }[];
    expect(first[0]?.id).toBe("attio/task.created:delivery-1");
    expect(second[0]?.id).toBe("attio/task.updated:delivery-1");
  });
});
