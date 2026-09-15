# Attio App Store vs App SDK vs REST OAuth

Research note, 2026-09-15. Primary sources: current [docs.attio.com](https://docs.attio.com) App SDK, sharing, and REST auth pages. This is not an implementation spec.

**Question:** Can this Projection be an Attio Marketplace (App Store) app, and does that force the App SDK + KV?

**Short answer:** App Store listing and App SDK are different. A public REST OAuth app can be listed. A pure App SDK app cannot replace Inngest + Postgres for reliable Projection. KV is the wrong store for Bindings.

---

## Sources

| Topic | Page |
| --- | --- |
| App SDK overview | [sdk/overview](https://docs.attio.com/sdk/overview) |
| Server functions (sandbox, not Node, 30s) | [server-functions](https://docs.attio.com/sdk/server/server-functions) |
| KV Store | [kv-store](https://docs.attio.com/sdk/server/kv-store) |
| Connections (Google OAuth via Attio) | [connections](https://docs.attio.com/sdk/server/connections/connections), [authenticating-to-external-services](https://docs.attio.com/sdk/guides/authenticating-to-external-services) |
| Webhook handlers (inbound from third parties) | [receiving-http-requests](https://docs.attio.com/sdk/guides/receiving-http-requests) |
| Publication lifecycle (SDK vs REST) | [the-publication-lifecycle](https://docs.attio.com/share/the-publication-lifecycle) |
| App Store publish | [publishing-to-the-app-store](https://docs.attio.com/share/publishing-to-the-app-store) |
| REST auth | [authentication](https://docs.attio.com/rest-api/guides/authentication) |

---

## 1. “Marketplace app” is not one architecture

[The publication lifecycle](https://docs.attio.com/share/the-publication-lifecycle) lists **both**:

| Platform | Public (any workspace) | Review |
| --- | --- | --- |
| **App SDK** | Install from App Store | Yes (listing + **code** review) |
| **REST API** | OAuth, then App Store | Yes (listing; OAuth entry URL must 200) |

Internal REST apps use API keys. Public REST apps use OAuth. Unpublished OAuth still works with a warning.

So “list on the App Store” does **not** require the App SDK, and does **not** require KV.

---

## 2. App SDK runtime vs this project’s Inngest plan

Apps “run inside Attio's infrastructure” ([overview](https://docs.attio.com/sdk/overview)).

Server functions ([server-functions](https://docs.attio.com/sdk/server/server-functions)):

- HTTP to Google **must** happen in `.server.ts` (no client `fetch`)
- Runtime **is not Node.js compatible**
- **Non-configurable 30 second timeout**
- JSON-serializable args/returns only

There is **no** documented Inngest, cron, debounce, or throttle in the App SDK. Catch-up (ADR-0005) has no home there.

Webhook handlers ([receiving-http-requests](https://docs.attio.com/sdk/guides/receiving-http-requests)) receive HTTP from **third parties** (e.g. Google). They are registered on `connection-added`. They are the wrong primitive for Attio `task.updated` (that is REST `POST /v2/webhooks` to a URL you control).

Workflow blocks can `defer` with no timeout, but they are workflow-builder steps, not an always-on Projection for every Qualifying Task.

---

## 3. KV is not a Binding store

[KV Store](https://docs.attio.com/sdk/server/kv-store): “lightweight… cache data, ensure webhook idempotency, or store **transient** server state.” API is `get` / `set` / `delete` with optional `ttlInSeconds`. **No** documented durability SLA, backup, query-by-calendar, or “use this for durable foreign keys.”

Bindings (ADR-0004) must survive process death, Heal, and Catch-up over every Bound Task. That is Postgres, not KV.

---

## 4. What the App SDK *is* good for

[Connections](https://docs.attio.com/sdk/server/connections/connections): Attio stores OAuth tokens. Redirect is `https://app.attio.com/apps/<slug>/oauth2/response`. Documented example of a **User Connection**: “Connecting one user's calendar to Attio.” Workspace Connection: one credential for the whole workspace.

Workspace settings can hold Connection timezone / Calendar id (not per-Task state).

`connection-added` can create the dedicated Calendar and kick Backfill **if** that work finishes in 30s or is handed off.

---

## 5. Task deep link

No Task URL is documented on [Get a task](https://docs.attio.com/rest-api/endpoint-reference/tasks/get-a-task) or the help center. Event `description` cannot honestly include an official Attio Task URL until one is documented. Do not invent a path.

---

## 6. Feasible shapes for *this* Projection

| Shape | App Store? | Inngest + durable Projection? | Google OAuth | Binding store | Complexity |
| --- | --- | --- | --- | --- | --- |
| Self-hosted REST (workspace token) | No | Yes (your Vercel) | You implement | Postgres | Lowest |
| Hosted REST OAuth (multi-workspace) | Yes, as REST app | Yes (your Vercel) | You implement | Postgres, keyed by workspace | Medium |
| App SDK only | Yes, as SDK app | **No** (30s sandbox, no cron, not Node) | Attio Connection | KV = **unfit** | High and unreliable |
| Hybrid: SDK UI + your workers | Yes, as SDK app | Yes, if handlers `fetch` your Inngest endpoint | Attio Connection | Postgres on your side | Highest (two runtimes) |

**Not invented:** an official “call Inngest from an Attio app” guide. Hybrid is allowed only in the sense that server functions may `fetch` third-party HTTPS APIs.

---

## 7. Collision with our glossary

Attio App SDK **Connection** = OAuth/secret to a third party.

This repo’s **Connection** = Attio workspace paired with a dedicated Google Calendar.

If the App SDK is used, keep our term for the pairing; call Attio’s object a **Google credential** (or similar), not Connection.

---

## 8. Docs-AI sketch vs official SDK (2026-09-15)

Verified via Attio Docs MCP against current pages. A docs chatbot described App SDK as: `.webhook.ts` listens for `task.created` / `task.updated`, then a server function `fetch`es Google; reverse is `connection-added` → Google watch → another webhook handler → `/v2/tasks`. “No server to deploy.”

**What is true**

- Google OAuth can be an App SDK [Connection](https://docs.attio.com/sdk/server/connections/connections); Attio stores the token; `getUserConnection()` / `getWorkspaceConnection()`.
- Server functions and webhook handlers run in Attio’s sandbox and may `fetch()` Google ([server-functions](https://docs.attio.com/sdk/server/server-functions)).
- Reverse direction (Google HTTP → `.webhook.ts` → Attio REST) **is** the documented webhook-handler shape ([webhook-handlers](https://docs.attio.com/sdk/server/webhooks/webhook-handlers): “incoming requests from **third-party** services”).

**What the chatbot got wrong**

- App SDK [Events](https://docs.attio.com/sdk/server/events/events) are only `connection-added` and `connection-removed`. There is no `task.created` event file.
- `.webhook.ts` does **not** subscribe to Attio Task events. You `createWebhookHandler()`, then register **that URL with the third party** (Acme / email tool examples). `task.created` is a [REST webhook](https://docs.attio.com/rest-api/webhook-reference/task-events/taskcreated) delivered to a `target_url` you pass to `POST /v2/webhooks`.
- The [SDK concepts](https://docs.attio.com/sdk/deep-dives/overview) example is a **button** → outbound API → later inbound webhook. It is not “every Task change automatically.”
- Pointing REST `target_url` at `createWebhookHandler().url` is **not documented**. Even if it worked, Attio REST delivery must 2xx within **5 seconds** ([webhooks guide](https://docs.attio.com/rest-api/guides/webhooks)); failures retry ~3 days then the webhook goes **degraded**, then **inactive**.
- KV is `get` / `set` / `delete` only, described as **transient**; **no list/scan**, so Catch-up cannot walk Bindings ([kv-store](https://docs.attio.com/sdk/server/kv-store)).
- No cron in the App SDK. Server functions: **30s** timeout, not Node. Backfill of existing Open Tasks and Google watch-channel renewal (7 days) have no scheduler.
