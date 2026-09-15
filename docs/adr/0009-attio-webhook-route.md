# Attio webhooks hit a Next.js route, not Inngest’s serve endpoint

Attio POSTs to `{APP_URL}/api/webhooks/attio`. The route verifies `Attio-Signature` on the raw body, then `inngest.send` with an event `id` derived from `Idempotency-Key`, and returns 2xx. Invalid signatures are 401 and never queued. `serve()` POST is Inngest invoking functions, not a third-party webhook. An Inngest-hosted transform would ack Attio before we can check HMAC and adds a dashboard URL the Operator must copy.
