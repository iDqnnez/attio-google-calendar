import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  attioTaskCreated,
  attioTaskDeleted,
  attioTaskUpdated,
} from "@/inngest/events";

const webhookBodySchema = z.object({
  events: z.array(
    z.object({
      event_type: z.string(),
      id: z.object({
        task_id: z.string().uuid(),
      }),
    }),
  ),
});

type TaskTrigger =
  | ReturnType<typeof attioTaskCreated.create>
  | ReturnType<typeof attioTaskUpdated.create>
  | ReturnType<typeof attioTaskDeleted.create>;

export async function receiveAttioWebhook(input: {
  rawBody: string;
  signature: string | null;
  idempotencyKey: string | null;
  secret: string | null;
  send: (triggers: TaskTrigger[]) => Promise<unknown>;
}): Promise<{ status: number }> {
  if (!attioSignatureMatches(input.rawBody, input.signature, input.secret)) {
    return { status: 401 };
  }

  const parsed = parseWebhookBody(input.rawBody);
  const toSend = parsed.flatMap((item) => {
    const trigger = taskTriggerFor(item.event_type);
    if (trigger == null) {
      return [];
    }
    return [
      trigger.create(
        { taskId: item.id.task_id },
        input.idempotencyKey == null || input.idempotencyKey === ""
          ? undefined
          : { id: `${trigger.name}:${input.idempotencyKey}` },
      ),
    ];
  });
  if (toSend.length > 0) {
    await input.send(toSend);
  }
  return { status: 200 };
}

function taskTriggerFor(eventType: string) {
  if (eventType === "task.created") {
    return attioTaskCreated;
  }
  if (eventType === "task.updated") {
    return attioTaskUpdated;
  }
  if (eventType === "task.deleted") {
    return attioTaskDeleted;
  }
  return null;
}

function parseWebhookBody(rawBody: string) {
  try {
    return webhookBodySchema.parse(JSON.parse(rawBody)).events;
  } catch {
    return [];
  }
}

function attioSignatureMatches(
  rawBody: string,
  signature: string | null,
  secret: string | null,
): boolean {
  if (signature == null || signature === "" || secret == null || secret === "") {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);
  return (
    provided.length === computed.length && timingSafeEqual(provided, computed)
  );
}
