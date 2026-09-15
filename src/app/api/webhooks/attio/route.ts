import { receiveAttioWebhook } from "@/attio/webhook";
import { findAttioWebhookSecret } from "@/db/connections";
import { inngest } from "@/inngest/client";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const result = await receiveAttioWebhook({
    rawBody,
    signature:
      request.headers.get("attio-signature") ??
      request.headers.get("x-attio-signature"),
    idempotencyKey: request.headers.get("idempotency-key"),
    secret: await findAttioWebhookSecret(),
    send: (payload) => inngest.send(payload),
  });
  return new Response(null, { status: result.status });
}
