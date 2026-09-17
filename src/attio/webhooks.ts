import { z } from "zod";
import type { AttioWebhookRegistry } from "@/connect/complete";

const createdWebhookSchema = z.object({
  data: z.object({
    id: z.object({
      webhook_id: z.string(),
    }),
    secret: z.string(),
  }),
});

export function attioWebhooks(apiToken: string): AttioWebhookRegistry {
  return {
    async create(input) {
      const response = await fetch("https://api.attio.com/v2/webhooks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: {
            target_url: input.targetUrl,
            subscriptions: input.subscriptions.map((subscription) => ({
              event_type: subscription.eventType,
              filter: subscription.filter,
            })),
          },
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `Attio webhook create failed (${response.status}): ${detail}`,
        );
      }
      const body = createdWebhookSchema.parse(await response.json());
      return { id: body.data.id.webhook_id, secret: body.data.secret };
    },
    async updateTargetUrl(id, targetUrl) {
      const response = await fetch(
        `https://api.attio.com/v2/webhooks/${id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: { target_url: targetUrl },
          }),
        },
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `Attio webhook update failed (${response.status}): ${detail}`,
        );
      }
    },
  };
}
