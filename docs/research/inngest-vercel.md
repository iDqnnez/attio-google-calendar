# Inngest on Vercel for Attio → Google Calendar sync

Research notes from **current official Inngest documentation** (`inngest.com/docs`), retrieved 2026-09-15. Several core pages are dated **June 16, 2026**. This is not an implementation spec; it records documented APIs and the architecture they imply for a two-system sync (Attio Tasks → Google Calendar) hosted on Next.js App Router / Vercel.

**Scope:** Inngest TypeScript SDK v4 patterns are treated as current. Older `EventSchemas` / second-argument trigger syntax is v3 and is called out where docs still mix both.

**Not invented here:** Attio webhook schemas, Google Calendar push-notification handshake, and Google quota numbers are **not** specified in Inngest docs. Those belong in Attio/Google docs. This file only maps Inngest primitives onto that shape.

---

## Sources

| Topic | Official page |
| --- | --- |
| Next.js App Router setup | [Next.js Quick Start](https://www.inngest.com/docs/getting-started/nextjs-quick-start) |
| Vercel deploy, `maxDuration`, integration | [Deploy: Vercel](https://www.inngest.com/docs/deploy/vercel) |
| `serve()` vs `connect()`, streaming / Fluid compute | [Serving Inngest functions](https://www.inngest.com/docs/learn/serving-inngest-functions) |
| `serve()` HTTP methods | [TypeScript: serve](https://www.inngest.com/docs/reference/typescript/serve) |
| Events, send, event `id` | [Sending events](https://www.inngest.com/docs/events), [Event format](https://www.inngest.com/docs/features/events-triggers/event-format), [TS send](https://www.inngest.com/docs/reference/typescript/events/send) |
| Webhooks + transforms + signature verify | [Consuming webhook events](https://www.inngest.com/docs/platform/webhooks) |
| Idempotency | [Handling idempotency](https://www.inngest.com/docs/guides/handling-idempotency) |
| Steps + memoization | [Inngest Steps](https://www.inngest.com/docs/learn/inngest-steps), [How functions are executed](https://www.inngest.com/docs/learn/how-functions-are-executed), [Versioning](https://www.inngest.com/docs/learn/versioning) |
| Fan-out / `step.sendEvent` | [Sending events from functions](https://www.inngest.com/docs/guides/sending-events-from-functions), [Crons](https://www.inngest.com/docs/guides/scheduled-functions) |
| Invoke | [Invoking functions directly](https://www.inngest.com/docs/guides/invoking-functions-directly) |
| Flow control | [Throttling](https://www.inngest.com/docs/guides/throttling), [Rate limiting](https://www.inngest.com/docs/guides/rate-limiting), [Debounce](https://www.inngest.com/docs/guides/debounce), [Retries](https://www.inngest.com/docs/features/inngest-functions/error-retries/retries) |
| Cancellation / `onFailure` | [Cancel on events](https://www.inngest.com/docs/features/inngest-functions/cancellation/cancel-on-events), [Handling failures](https://www.inngest.com/docs/reference/typescript/functions/handling-failures) |
| TS v4 schemas | [Trigger helpers](https://www.inngest.com/docs/reference/typescript/v4/functions/triggers), [v3 → v4 migration](https://www.inngest.com/docs/reference/typescript/v4/migrations/v3-to-v4) |
| Checkpointing / serverless | [Checkpointing](https://www.inngest.com/docs/setup/checkpointing) |
| Limits | [Usage limits](https://www.inngest.com/docs/usage-limits/inngest) |
| DB examples | [Middleware examples](https://www.inngest.com/docs/reference/typescript/v4/middleware/examples), [Neon triggers](https://www.inngest.com/docs/features/events-triggers/neon) |
| Function config | [createFunction (v4)](https://www.inngest.com/docs/reference/typescript/v4/functions/create) |

---

## 1. Recommended project structure (Next.js App Router / Vercel)

Official Next.js App Router layout ([quick start](https://www.inngest.com/docs/getting-started/nextjs-quick-start), [serving](https://www.inngest.com/docs/learn/serving-inngest-functions), [Vercel](https://www.inngest.com/docs/deploy/vercel)):

```
src/inngest/client.ts          # new Inngest({ id: "…" })
src/inngest/functions.ts       # createFunction exports (or a functions/ dir)
src/app/api/inngest/route.ts   # serve() — GET + POST + PUT
```

**Client** — single exported client; app id is the Inngest app identity:

```ts
// src/inngest/client.ts
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "my-app" });
```

On serverless, v4 also expects checkpointing `maxRuntime` on this client (see §10).

**Serve endpoint** — App Router must export `GET`, `POST`, and `PUT` from `inngest/next`. Vercel docs set `maxDuration` on this route:

```ts
// src/app/api/inngest/route.ts
import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import { firstFunction, anotherFunction } from "../../../inngest/functions";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [firstFunction, anotherFunction],
});
```

`serve()` HTTP verbs ([serve reference](https://www.inngest.com/docs/reference/typescript/serve)):

| Method | Purpose |
| --- | --- |
| `GET` | Function metadata; landing page in development |
| `POST` | **Inngest invoking your functions** (request body is function state) |
| `PUT` | Register / sync function config with Inngest using the signing key |

Default path is `/api/inngest` (changeable via `servePath` / `INNGEST_SERVE_PATH`). Automated deploys are easier if you keep that path.

**Sending events from the app** — separate App Router routes call `inngest.send()`. The quick start uses `src/app/api/create-task/route.ts` and explicitly lists **webhook handlers** as a place to call `send()`.

**Local:** `INNGEST_DEV=1` (v4 cloud mode requires a signing key otherwise) + `inngest dev` / `npx inngest-cli@latest dev` (UI at `http://localhost:8288`).

**Production on Vercel:** official [Vercel integration](https://www.inngest.com/docs/deploy/vercel) sets `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` and resyncs on each deploy. If Deployment Protection is on, configure Vercel “Protection Bypass for Automation” and paste the secret into Inngest’s Vercel integration settings. Optional: `INNGEST_SERVE_ORIGIN` to sync against a custom domain instead of unique `*.vercel.app` deployment URLs.

**`serve()` vs `connect()`:** `serve()` is documented as ideal for serverless (Vercel, Lambda). `connect()` is outbound WebSocket workers (containers, latency-sensitive, horizontal workers). Functions are portable between the two.

---

## 2. Events vs functions vs steps. Fan-out. Idempotency

### Events

An event is a JSON object that **must** have `name` and `data` ([event format](https://www.inngest.com/docs/features/events-triggers/event-format)). Optional: `id` (dedup), `ts` (ms epoch; future `ts` schedules the run), `v` (payload version), `meta.sessions`.

Naming tips from the same page: Object-Action, past tense, prefixes such as `stripe/customer.created`. One event can trigger **many** functions (fan-out); this is unlike a queue where one worker consumes a message ([sending events](https://www.inngest.com/docs/events)).

### Functions

`inngest.createFunction({ id, triggers, …flow control }, handler)`. Triggers are events and/or crons. v4 puts `triggers` in the **first** argument ([migration](https://www.inngest.com/docs/reference/typescript/v4/migrations/v3-to-v4)). Cron-only runs **do not receive `event`** ([createFunction](https://www.inngest.com/docs/reference/typescript/v4/functions/create)). Overlapping cron schedules on one function are deduplicated.

### Steps

Steps are checkpointed units inside a function ([steps](https://www.inngest.com/docs/learn/inngest-steps)). Put side effects (API calls, DB writes) in `step.run()`. Other methods: `sleep` / `sleepUntil`, `waitForEvent`, `waitForSignal`, `invoke`, `sendEvent`.

Without checkpointing, each step is a separate HTTP request to your serve endpoint ([execution model](https://www.inngest.com/docs/learn/how-functions-are-executed)). v4 checkpointing can run multiple steps in one request (see §10).

### Fan-out

Two documented patterns:

1. **One event → many functions** listening on the same name.
2. **Orchestrator sends many events** via `step.sendEvent(id, event | event[])` so each item becomes its own run ([sending events from functions](https://www.inngest.com/docs/guides/sending-events-from-functions), [crons](https://www.inngest.com/docs/guides/scheduled-functions)).

`step.sendEvent` vs `inngest.send()` inside a function: `step.sendEvent` adds run context/tracing and is wrapped as a durable step so delivery is not duplicated on retry. Use `inngest.send()` **outside** functions (API routes, webhook handlers).

`step.invoke()` vs `step.sendEvent()` ([invoke guide](https://www.inngest.com/docs/guides/invoking-functions-directly)):

| | `step.sendEvent` / fan-out | `step.invoke` |
| --- | --- | --- |
| Result returned to caller | No | Yes (RPC-like) |
| Bulk | Yes (array) | One function at a time |
| Parallel independent work | Intended | Coordinated / needs return value |
| Child flow control | Child’s own config | Child’s own config (use invoke when the child needs its own concurrency, etc.) |

v4: `step.invoke()` no longer accepts a raw string function id; pass a function instance or `referenceFunction()`.

### Idempotency (three layers)

Documented in [handling idempotency](https://www.inngest.com/docs/guides/handling-idempotency) and [events](https://www.inngest.com/docs/events):

1. **Event `id` (producer)** — unique string on `inngest.send()` / webhook transform. Duplicate `id`s within **24 hours** do not trigger functions again (second event is stored in history). The `id` is **global across event types**; include the event type in the id (`item-imported-9f08sdh84`, not just the item id). Ignored by debounce, event batching, and while a function is paused.

2. **Function `idempotency` (consumer)** — CEL expression on the event, e.g. `'event.data.cartId'`. Equivalent to `rateLimit` with `limit: 1`, `period: 24hr`, plus a key. Use when you cannot set event `id` (webhooks) or when **only some** of several fan-out consumers should be unique.

3. **Idempotent step code** — docs still say write upserts yourself; Inngest keys only suppress duplicate **runs**, not duplicate side effects if a step succeeded in a way that was not recorded, or after the 24h window.

There is no separate documented “idempotency key” field besides event `id` and function `idempotency`.

---

## 3. Ingesting third-party webhooks (Attio, Google push)

Three documented paths. **`serve()` `POST` is not a third-party webhook endpoint.** It is how Inngest invokes *your* functions, authenticated with the Inngest signing key ([serve](https://www.inngest.com/docs/reference/typescript/serve), [signing keys](https://www.inngest.com/docs/platform/signing-keys)). Pointing Attio/Google at `/api/inngest` would not transform their payloads into events.

### A. Inngest-hosted webhook + transform (recommended default for JSON providers)

[Consuming webhook events](https://www.inngest.com/docs/platform/webhooks):

- Create a unique URL in Inngest Cloud (**Manage → Webhooks**). Provider POSTs there. Transform runs **on Inngest’s servers**.
- Transform must return `{ name, data }` (optional `id`, `ts`).
- Prefix names: `clerk/user.created`, `stripe/charge.failed`.
- Stripe example sets `id: evt.id` **in the transform** for dedup — same mechanism as event `id`.
- Supported content types: `application/json`; `application/x-www-form-urlencoded` and `multipart/form-data` are documented as beta.
- Transform errors → HTTP 400 to the provider (retry). Catching errors yourself returns 200 (provider typically will **not** retry).
- Branch environments share webhooks; set `x-inngest-env` query param or header or events land in a catch-all and do not trigger functions.

**Signature verification placement (Inngest webhooks):** transforms cannot keep a secret and verify HMAC on Inngest’s side in the documented Stripe pattern. Return `raw` body + signature header from the transform, then verify **inside the Inngest function**. On failure, `throw new NonRetriableError(...)`.

```ts
function transform(evt, headers, queryParams, raw) {
  return {
    name: `stripe/${evt.type}`,
    data: { raw, sig: headers["Stripe-Signature"] },
  };
}
```

Header names are canonicalized (first letter and after hyphens uppercased).

Local: dashboard **Send to Dev Server** forwards a stored event; it does not re-run the provider’s HTTP.

### B. Custom Next.js route + `inngest.send()`

Quick start: call `send()` from **webhook handlers** and API routes. Pattern:

1. Provider hits `src/app/api/…/route.ts`.
2. Verify signature / channel token **in that route** (before enqueue).
3. `await inngest.send({ name, data, id })` — always `await`; serverless can freeze before the HTTP call completes ([events](https://www.inngest.com/docs/events)).
4. Return 200 quickly; work happens in Inngest functions.

Use this when you need GET challenge responses, non-JSON bodies Inngest webhooks do not support, or verification that must happen before the event is accepted.

### C. `serve()` POST

Do **not** use for Attio/Google. Inngest SDKs reject unsigned requests using `INNGEST_SIGNING_KEY`.

### Mapping to this product

| Source | Fit from Inngest docs only |
| --- | --- |
| Attio JSON webhooks | Path A (transform + `id` from Attio delivery/event id) or Path B if you want to verify Attio signatures on Vercel before enqueue |
| Google Calendar push | Path B is the documented escape hatch for “custom webhook handler → `send()`”. Google watch verification / channel headers are **not** in Inngest docs; design that against Google’s API, then `send()` |

Inngest signing key authenticates **Inngest ↔ your `/api/inngest`**. It does **not** replace Attio/Google signature checks.

---

## 4. Retries, concurrency, debounce/throttle, rate limiting, onFailure, cancellation

### Retries

Default: **4 retries + 1 initial = 5 attempts** ([retries](https://www.inngest.com/docs/features/inngest-functions/error-retries/retries)). `retries: 0` disables. Configurable **0–20** on the function ([createFunction](https://www.inngest.com/docs/reference/typescript/v4/functions/create)). Exponential backoff + jitter.

Each `step.run()` has an **independent** retry counter (function `retries` applies per step, not a shared pool).

- `NonRetriableError` — skip remaining retries (e.g. bad signature, missing task).
- `RetryAfterError(message, retryAfter)` — honor `Retry-After` (documented Twilio example; same idea for Google 429).

### Concurrency

Caps **concurrently executing steps**, not in-flight runs. Sleeps/waits do not count. Optional CEL `key` (e.g. per user). Scopes: `fn` (default), `env`, `account`. Plan caps concurrent steps (Free 5, Basic 25, Pro 200+).

Docs: if a third-party API allows “100 req/min”, that is **throttle**, not concurrency. Concurrency is “don’t run more than N steps at once” (DB pool, process limits).

### Throttle (use this for Google Calendar quota)

[Throttling](https://www.inngest.com/docs/guides/throttling): first documented use case is **working around third-party API rate limits**. Excess runs are **queued FIFO**, not dropped. Applies to **run starts**, not steps inside a run.

```ts
throttle: {
  limit: 1,
  period: "5s",
  burst: 2,
  key: "event.data.user_id",
}
```

Period: **1s–7d**. Per-function (two functions with the same key have separate limits). Combine with `timeouts.start` so huge backlogs cancel instead of waiting forever ([createFunction `timeouts`](https://www.inngest.com/docs/reference/typescript/v4/functions/create); throttle guide: “Configure start timeouts to prevent large backlogs”).

### Rate limit (lossy)

[Rate limiting](https://www.inngest.com/docs/guides/rate-limiting): excess events are **skipped**. Use for noisy webhooks when you **do not** need every event. **Do not** use if every task change must apply. Max period **24 hours** (guide). Function `idempotency` = rateLimit 1 / 24h.

If `rateLimit` and throttle conflict in your head: **Google quota → throttle**. **“Only sync this company every 4h”** (example in the rate-limit guide) → rateLimit. **Latest-write-wins bursts** → debounce.

### Debounce

[Debounce](https://www.inngest.com/docs/guides/debounce): wait until events stop; run **once with the last event**. Documented for noisy webhooks and **synchronization**. `period` 1s–7d; optional `timeout` so it cannot delay forever; optional `key`. **Does not work with batched functions.** Can be combined with function `idempotency`.

### onFailure

[Handling failures](https://www.inngest.com/docs/reference/typescript/functions/handling-failures): runs only after **all** retries fail. Implemented as a second function on system event `inngest/function.failed`. Use for Slack/Sentry/rollback. Custom error classes deserialize as plain `Error` (no `instanceof`). Or subscribe to `inngest/function.failed` once for all functions.

### Cancellation

[`cancelOn`](https://www.inngest.com/docs/features/inngest-functions/cancellation/cancel-on-events): matching event (CEL `if` / `match`) marks the run Canceled (including during `sleepUntil`). Up to **five** cancel events; optional timeout window. Example: `tasks/reminder.deleted` cancels `tasks/reminder.created` when `async.data.reminderId == event.data.reminderId`.

Also: `timeouts.start` / `timeouts.finish` cancel runs that wait too long to start or run too long.

---

## 5. Deduplicating duplicate webhook deliveries

Layer, in order, what the docs actually provide:

1. **Event `id` in the webhook transform** (Stripe `evt.id` example) or in `inngest.send({ id })` from a custom route. 24h window. Make ids **event-type-specific**.
2. **Function `idempotency` CEL** if you cannot set `id`, or only one of several consumers should be unique.
3. **Debounce per Attio task id** so rapid `task.updated` deliveries collapse to the latest payload (sync use case in debounce docs).
4. **Idempotent upsert** in `step.run` (mapping table / Google `events.update` with stored event id). Inngest does not replace this.
5. **Do not use `rateLimit`** to drop duplicates if you still need the latest state — it keeps the **first** event, not the last (opposite of debounce).

Remember: event `id` is ignored during debounce/batching/paused functions.

---

## 6. Fan-out for backfill / initial sync

Official pattern: scheduled or event-triggered **loader** fetches a list, maps to events, `step.sendEvent` in batches; **workers** handle one item ([crons](https://www.inngest.com/docs/guides/scheduled-functions), [fan-out](https://www.inngest.com/docs/guides/sending-events-from-functions)).

Limits that constrain backfill ([usage limits](https://www.inngest.com/docs/usage-limits/inngest), [events](https://www.inngest.com/docs/events)):

| Limit | Value | Implication |
| --- | --- | --- |
| Events per `send` / `sendEvent` | 5000 | Chunk the task list |
| Payload per request | Plan-dependent (Free 256KiB, Basic 512KiB, Pro 3MiB). Events page also says **512kb per request** as default | Keep batches small; paginate Attio |
| Steps per function | **1000** | Do **not** `step.run` per task in one backfill run — “easily reached if you're using step on each item in a loop.” Docs recommend process-in-one-step **or fan-out** |
| Parallel steps vs fan-out | 1000 step cap vs unbounded function runs | Fan-out for many tasks |

Put **throttle + concurrency** on the **per-task worker** (Google quota), not only on the loader. Loader should finish quickly after enqueueing.

`step.invoke` is a poor fit for thousands of independent upserts (one-at-a-time, caller waits). Use it if a parent must await a typed child result (e.g. “create calendar then return calendar id”).

Optional `batchEvents` (max 100 events, timeout 1–60s, 10 MiB hard cap) can group worker inputs; **incompatible with debounce**.

---

## 7. Durable steps: fetch → map → upsert Google → persist mapping

Documented shape ([retries](https://www.inngest.com/docs/features/inngest-functions/error-retries/retries) `sync-systems` example, [execution](https://www.inngest.com/docs/learn/how-functions-are-executed)):

```ts
const data = await step.run("get-data", async () => { /* Attio fetch */ });
await step.run("save-data", async () => { /* Google upsert + mapping write */ });
```

Split Google upsert and mapping persist if you need independent retries. Treat each `step.run` as a **transaction**: the whole callback succeeds or the step retries. If Google create succeeds and the process dies before you return/store the new event id, a retry **will call Google again** unless the step already checkpointed a result — so either:

- return the Google event id from the upsert step, then persist mapping in a following step, **and** make the upsert itself an upsert keyed by stored mapping / extended properties, or
- keep both in one step so they commit together (at the cost of retrying Google if the DB write fails).

### Memoization gotchas ([versioning](https://www.inngest.com/docs/learn/versioning), [steps](https://www.inngest.com/docs/learn/inngest-steps), [execution](https://www.inngest.com/docs/learn/how-functions-are-executed))

- Step id is hashed **plus a counter** so the same id in a loop is allowed.
- Completed steps **never re-execute**, including after deploys. Changing code inside the same id does **not** re-run in-progress runs; **change the step id** to force re-execution.
- New steps run when discovered; reordering logs a **warning**, does not fail.
- Non-deterministic work (HTTP, `Date.now()`, DB) **must** be inside `step.run` (or it re-runs on every replay/memoization pass).
- Step output is JSON: `Date` / `Map` / `Set` are lost unless serializer middleware ([middleware examples](https://www.inngest.com/docs/reference/typescript/v4/middleware/examples)).
- Step return ≤ **4MiB**; whole run state ≤ **32MiB**. Do not dump full Google/Attio payloads into every step return.
- Prefer stable descriptive ids (`upsert-google-event`), not `step-1`.
- v4 **optimized parallelism** is on by default: `Promise.race` waits for all; use `group.parallel()` if you needed early race ([migration](https://www.inngest.com/docs/reference/typescript/v4/migrations/v3-to-v4)).

---

## 8. Cron vs event-driven for catch-up

| | Event-driven | Cron |
| --- | --- | --- |
| Trigger | Webhook / `send()` | Unix cron, optional `TZ=…` prefix |
| `event` in handler | Yes | **No** for cron-only |
| Official bulk pattern | Fan-out from a “sync requested” event | Loader cron + `step.sendEvent` per item |
| Overlap | N/A | Overlapping crons on **one** function are deduplicated |
| DST | N/A | No special DST correction; prefer `TZ=UTC` near transitions |
| Thundering herd | Webhook bursts → debounce/throttle | Optional `jitter` `"1s"`–`"5m"` |

Same function may take **both** `cron("0 */6 * * *")` and an event type ([trigger helpers](https://www.inngest.com/docs/reference/typescript/v4/functions/triggers)).

**For this sync:** live path = Attio/Google webhooks → worker. Catch-up / missed webhooks = cron (or manual `app/sync.requested`) that lists unsynced tasks and fans out. Cron is not a substitute for webhooks; it is reconciliation. Free plan: 20 consecutive cron failures pause the function.

---

## 9. TypeScript SDK patterns and event schemas

**Current (v4)** — [trigger helpers](https://www.inngest.com/docs/reference/typescript/v4/functions/triggers), [migration](https://www.inngest.com/docs/reference/typescript/v4/migrations/v3-to-v4):

- `EventSchemas` on the client is **removed**.
- `eventType(name, { schema, version? })` — schema is any **Standard Schema** library (Zod, Valibot, ArkType) **or** `staticSchema<T>()`.
- Runtime schema ⇒ runtime validation on send, wait, and trigger. `staticSchema` ⇒ types only.
- **Zod `.transform()` is not supported** on `eventType` schemas (producer transforms, consumer validates input shape → mismatch). Transform inside the handler.
- Use `orderPlaced.create({ … })` with `inngest.send` / `step.sendEvent`.
- `triggers: [orderPlaced, cron("0 * * * *")]`.
- `invoke({ schema })` types `step.invoke` input.
- Wildcard `eventType("user/*")` cannot have a schema.
- `event.user` **removed** in v4; put fields in `data`. Some send-reference pages still mention `user`; follow the migration guide.
- Serve options (`signingKey`, `baseUrl`, …) moved to the **client**. `streaming` on `serve()` is `true | false` (not `"force"`).
- Default mode is **cloud**; local needs `INNGEST_DEV=1` or `isDev: true`.

v3 `new EventSchemas().fromRecord<…>()` should not be used on new code.

---

## 10. Vercel-specific: Fluid compute, duration, cold start, Trigger.dev

### `maxDuration` and checkpointing

[Vercel deploy](https://www.inngest.com/docs/deploy/vercel) + [checkpointing](https://www.inngest.com/docs/setup/checkpointing) + [v4 migration](https://www.inngest.com/docs/reference/typescript/v4/migrations/v3-to-v4):

- Set `export const maxDuration = 300` (or your plan’s max) on `/api/inngest`.
- v4 checkpointing is **on by default**. Set client `checkpointing.maxRuntime` to **~60–80% of `maxDuration`** (Vercel guide: 20–40% **below** `maxDuration`; migration example: `50s` if max is `60s`).
- `maxRuntime` default `0` = unlimited — unsafe on serverless because the platform kills the request.
- With streaming enabled, functions can run **beyond** `maxDuration` (Vercel tip).

### Fluid compute and streaming

[Serving Inngest functions](https://www.inngest.com/docs/learn/serving-inngest-functions): Next.js on Vercel **with Fluid compute** can stream to Inngest and reach **800s (13m20s)** on a **paid** Vercel plan:

```ts
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...fns],
  streaming: true,
});
```

Without Fluid, same `streaming: true` plus `export const runtime = "edge"`.

### Cold start

Docs do not give a numeric cold-start SLA. Mitigations they **do** document:

- Checkpointing: multiple steps per request (less chatty HTTP).
- Fluid + streaming: longer executions, fewer hard timeouts.
- `connect()` if you leave serverless (not the Vercel-default path).
- Inngest compares itself to Temporal as **serverless-native** (`serve` HTTP) vs worker polling ([execution](https://www.inngest.com/docs/learn/how-functions-are-executed)).

### Inngest vs Trigger.dev

**Official Inngest docs do not mention Trigger.dev.** They recommend `serve()` for Vercel/Next.js and compare durable execution to **Temporal**, not Trigger.dev. No documented “use X instead of Inngest for two-system sync.” Stay on Inngest `serve()` + Vercel integration as specified.

---

## 11. Mapping state: Inngest is not your database

Inngest persists **function run state** (step outputs, retries) in its own store. That is not an application mapping table (Attio task id ↔ Google event id).

What official examples **do** use:

| Example | Role |
| --- | --- |
| Generic `db` / `db.load("SELECT * FROM users")` in [cron fan-out](https://www.inngest.com/docs/guides/scheduled-functions) | App data |
| **Prisma** injected via middleware ([middleware examples](https://www.inngest.com/docs/reference/typescript/v4/middleware/examples)) | `prisma.auditTrail.create` inside functions |
| `db.syncs.insertOne` / `db.clicks.insertOne` in [retries](https://www.inngest.com/docs/features/inngest-functions/error-retries/retries) | Persist after fetch |
| [Neon integration](https://www.inngest.com/docs/features/events-triggers/neon) | Postgres **as event source** (logical replication), not as Inngest replacing Postgres |
| Self-hosting Postgres/SQLite/Redis | **Inngest server** internals, not your mapping rows |

**No official example uses Vercel KV / Upstash as the mapping store.** Docs never say “put mappings in KV.”

Practical reading of the docs: use **Postgres** (Prisma + Neon/Supabase/RDS — whatever the app already has). Wrap reads/writes in `step.run`. Optionally inject Prisma with middleware. Neon→Inngest CDC is a separate trigger path (production-only, one DB), not required for Attio webhooks.

---

## Recommended architecture (this repo)

```
Attio webhook ──► Inngest webhook transform (set name + event id)
                      │
Google push ───► Next.js route (verify, then inngest.send)
                      │
                      ▼
              Inngest Cloud (queue, fan-out, throttle)
                      │
                      ▼
         Vercel /api/inngest  (serve GET/POST/PUT)
                      │
         functions: upsert-task, backfill-loader, catch-up cron
                      │
         Postgres mapping table (Prisma) inside step.run
                      ▼
              Google Calendar API
```

**Runtime**

- Next.js App Router on Vercel; `src/inngest/client.ts` + `functions/` + `app/api/inngest/route.ts`.
- Vercel integration for keys + sync; `maxDuration` on the serve route; `checkpointing.maxRuntime` on the client; `streaming: true` if Fluid compute is on.
- `INNGEST_DEV=1` locally.

**Live sync**

- Attio: Inngest webhook; transform to `attio/task.*`; set `id` from provider delivery/event id; optionally pass `raw`+signature and verify in-function with `NonRetriableError`.
- Google push: custom route → verify → `inngest.send` with a typed `eventType`.
- Worker: debounce per Attio task id (latest wins); throttle toward Google quota; concurrency key per calendar/user; `RetryAfterError` on 429; upsert Google then persist mapping in durable steps.
- `cancelOn` for task deleted while a run is in flight.

**Backfill**

- Event `app/sync.backfill.requested` or a cron loader: page Attio in `step.run`, `step.sendEvent` in chunks ≤ 5000 events / payload cap. Do not loop `step.run` per task (1000-step cap).
- Same worker as live sync so throttle/idempotency apply.

**Catch-up**

- Event-driven webhooks for freshness; periodic cron to list drift and fan out. Not cron-only.

**State**

- Postgres mapping (task id, google event id, etags/updated-at). Inngest for orchestration only.

**Types**

- SDK v4: `eventType` + Zod (no `.transform()`), `cron()`, `invoke()` as needed.

---

## Docs gaps / inconsistencies (do not paper over)

- **Trigger.dev** is not discussed in Inngest docs.
- **Vercel KV** is not an official mapping recommendation.
- **Google Calendar / Attio** are not named; webhook transforms are illustrated with Stripe, Clerk, GitHub, Linear, Resend, Intercom.
- [createFunction](https://www.inngest.com/docs/reference/typescript/v4/functions/create) snippet text for `rateLimit.period` looks copy-pasted (“1s to 60s”); the dedicated [rate limiting guide](https://www.inngest.com/docs/guides/rate-limiting) says max period **24 hours**. Trust the guide.
- Events page “512kb per request” vs usage-limits **per-event** plan caps and **5000 events/request** — treat both as constraints; size batches conservatively.
- `event.user` still appears in the send reference; v4 migration removes it.
