# Attio Tasks API — research note (2026-09-15)

Primary sources: current Attio developer docs at [docs.attio.com](https://docs.attio.com/llms.txt) and OpenAPI at [api.attio.com](https://api.attio.com/openapi/api). [developers.attio.com](https://developers.attio.com/) now serves the same developer-platform overview and points at `https://docs.attio.com/llms.txt`. REST API version in OpenAPI: **2.0.0**. Production base URL: `https://api.attio.com`.

This note is for an **Attio Tasks → Google Calendar** sync. It does not invent endpoints. If a capability is not in these docs, it is marked **not documented**.

Related Attio surface (not a Tasks API): Meetings are “events synced from your calendar, added manually or added from third-party integrations” ([List meetings](https://docs.attio.com/rest-api/endpoint-reference/meetings/list-meetings)). That is inbound calendar data into Attio, not a way to push Tasks out to Google Calendar.

---

## Design constraints (read this first)

1. **No `updated_at` on Task.** List/get return `created_at` and `completed_at` only. There is **no** documented `updated_at` filter. Incremental backfill by “tasks changed since T” is **not documented**.
2. **List filters do not include deadline.** Open tasks: `GET /v2/tasks?is_completed=false`. Deadline-window queries are **not documented**. Sort is `created_at` or `completed_at` only.
3. **Webhooks are ID-only.** `task.created` / `task.updated` / `task.deleted` carry `webhook_id`, `events[].id.{workspace_id,task_id}`, and `actor`. Fetch the task with `GET /v2/tasks/{task_id}` (deleted → 404).
4. **At-least-once delivery.** Deduplicate on the `Idempotency-Key` header. REST write **idempotency keys are not documented**.
5. **Cannot store a Google event ID on a Task.** No custom attributes, metadata bag, or extra fields. PATCH cannot update `content`. Mapping must live **outside** the Task object (your DB, or App SDK KV if this is an Attio App).
6. **Tokens are workspace-scoped.** `GET /v2/self` `sub` is `workspace_id`. Per-request “which user is acting” is **not** on the token; webhook `actor` / task `created_by_actor` identify people after the fact.
7. **`deadline_at` is under-specified.** Create/update examples are UTC datetimes; the read example is `'2023-01-01'`. Date-only vs datetime, timezone, and all-day mapping are **not documented** beyond “ISO 8601” / “deadline date … ISO 8601 timestamp”.
8. **Content is not updatable via API.** PATCH allows only `deadline_at`, `is_completed`, `linked_records`, `assignees`. Title in Google Calendar must come from `content_plaintext`; UI content edits may not be syncable back through PATCH.
9. **Pagination is limit/offset** (default limit 500), not cursor. Offset pagination is the documented backfill path. SQL/export **does not include tasks**.
10. **Completed ≠ deleted.** Completion is `is_completed` / `completed_at`. Delete is `DELETE` and is permanent. Task **archive** is **not documented**.

---

## 1. Task object model

Source of truth: `components.schemas.task` on [List tasks](https://docs.attio.com/rest-api/endpoint-reference/tasks/list-tasks) / [Get a task](https://docs.attio.com/rest-api/endpoint-reference/tasks/get-a-task) (OpenAPI `https://api.attio.com/openapi/api`).

Tag description: “A task is a defined, actionable item with references to linked records and assigned workspace members.”

There is **no** separate `title` field. Body text is `content` on create and `content_plaintext` on read.

| Field | Type (OpenAPI) | Required on read | Notes |
| --- | --- | --- | --- |
| `id.workspace_id` | uuid string | yes | Workspace the task belongs to |
| `id.task_id` | uuid string | yes | Task ID |
| `content_plaintext` | string | yes | “The plaintext representation of the task content. Inline linked records will appear as `@record name` and are returned in the `linked_records` property.” Example: `Follow up on current software solutions` |
| `deadline_at` | string \| null | yes (nullable) | Description: “The deadline **date** of the task. Returned as an ISO 8601 **timestamp**.” Example: `'2023-01-01'` (date-only) |
| `is_completed` | boolean | yes | “Whether the task has been completed.” |
| `completed_at` | string \| null | yes (nullable) | “When the task was completed, or null if it has not been completed.” Example: `'2022-11-21T13:22:49.061281000Z'` |
| `linked_records[]` | array of `{target_object_id, target_record_id}` | yes | See §10. Read description also says: “Creating record links within task content text is not possible via the API at present.” |
| `assignees[]` | array of `{referenced_actor_type, referenced_actor_id}` | yes | “Workspace members assigned to this task.” |
| `created_by_actor` | `{id?: string \| null, type?: enum \| null}` | yes | Actor who created the task |
| `created_at` | string | yes | “When the task was created.” Example nanosecond UTC |

**Not present on the documented Task schema** (do not assume they exist):

- `updated_at`
- `title` (use `content_plaintext`)
- `is_archived`
- `metadata`, `custom_fields`, extra key/value bag
- `timezone` / `all_day` flags
- `workspace` as a nested object (only `id.workspace_id`)

### Assignees / actors (read)

`referenced_actor_type` enum on **read**: `api-token` | `workspace-member` | `system` | `app`. `referenced_actor_id` is described as “The ID of the **workspace member** actor assigned to this task.”

On **create/update**, only `workspace-member` may be assigned: “Only `workspace-member` actors can be assigned to tasks.” Assignees may also be passed as `{workspace_member_email_address}` ([Create a task](https://docs.attio.com/rest-api/endpoint-reference/tasks/create-a-task)).

Actor types in the [Actors](https://docs.attio.com/docs/actors) guide: `workspace-member` (UUID), `api-token` (UUID), `system` (`null` ID). The Task schema also lists `app`; that type is **not** listed on the Actors page.

### Create vs read field names

Create uses `content` + `format: "plaintext"` (maxLength 2000). Read returns `content_plaintext`. Rich text, links, and `@references` are **not** supported on create ([Create a task](https://docs.attio.com/rest-api/endpoint-reference/tasks/create-a-task)).

Create `linked_records` items use `target_object` + `target_record_id`. Read items use `target_object_id` + `target_record_id`.

Create required body keys: `content`, `format`, `deadline_at`, `is_completed`, `linked_records`, `assignees` — including when `deadline_at` is `null` and arrays are empty.

---

## 2. Task CRUD REST endpoints

Base: `https://api.attio.com` ([OpenAPI servers](https://docs.attio.com/rest-api/endpoint-reference/tasks/list-tasks)).

| Method | Path | Docs | Scopes |
| --- | --- | --- | --- |
| GET | `/v2/tasks` | [List tasks](https://docs.attio.com/rest-api/endpoint-reference/tasks/list-tasks) | `task:read`, `object_configuration:read`, `record_permission:read`, `user_management:read` |
| POST | `/v2/tasks` | [Create a task](https://docs.attio.com/rest-api/endpoint-reference/tasks/create-a-task) | `task:read-write` + same three reads |
| GET | `/v2/tasks/{task_id}` | [Get a task](https://docs.attio.com/rest-api/endpoint-reference/tasks/get-a-task) | same as list |
| PATCH | `/v2/tasks/{task_id}` | [Update a task](https://docs.attio.com/rest-api/endpoint-reference/tasks/update-a-task) | same as create |
| DELETE | `/v2/tasks/{task_id}` | [Delete a task](https://docs.attio.com/rest-api/endpoint-reference/tasks/delete-a-task) | `task:read-write` only |

GET/DELETE 404: `invalid_request_error` / `not_found` (“Could not find Task with ID …”). DELETE 200 body is `{}`.

### List: pagination

[List tasks](https://docs.attio.com/rest-api/endpoint-reference/tasks/list-tasks) query params:

- `limit` — integer, default **500**, see [pagination](https://docs.attio.com/rest-api/guides/pagination)
- `offset` — integer, default **0**

This is **limit/offset**, not cursor. Cursor pagination is documented for other resources (e.g. meetings), not for tasks ([Paginating API results](https://docs.attio.com/rest-api/guides/pagination)).

**Not documented:** maximum `limit` other than the default 500; `next_cursor` / `pagination` object on list tasks.

### List: sort

`sort` enum:

- `created_at:asc` (default if unspecified; same as “oldest first”)
- `created_at:desc`
- `completed_at:asc` — incomplete first, then completed oldest-first
- `completed_at:desc` — completed newest-first, then incomplete

**Not documented:** sort by `deadline_at` or `updated_at`.

### List: filters (documented)

| Param | Purpose |
| --- | --- |
| `linked_object` + `linked_record_id` | Tasks whose `linked_records` contain that record. Both required together. Example object: `people` |
| `assignee` | Workspace member email **or** ID. Empty / string `null` → no assignee |
| `is_completed` | Omit = both. `true` = completed only. `false` = non-completed only |

**Open / incomplete tasks:** `is_completed=false`.

**Not documented on List tasks:** filter by `deadline_at`, `created_at` range, or `updated_at`. The [Filtering and sorting](https://docs.attio.com/rest-api/guides/filtering-and-sorting) guide’s `filter` / `sorts` JSON applies to **record and entry query** endpoints, not to `GET /v2/tasks` (overview: “Filtering and sorting **record and entry** API queries”).

MCP prompt examples such as “incomplete tasks due this week” ([MCP overview in llms-full](https://docs.attio.com/mcp/overview)) are **not** REST list filters.

### Update: writable fields

“At present, only the `deadline_at`, `is_completed`, `linked_records`, and `assignees` fields can be updated.” ([Update a task](https://docs.attio.com/rest-api/endpoint-reference/tasks/update-a-task))

**Cannot PATCH:** `content` / `content_plaintext`, `created_at`, `created_by_actor`, `completed_at` as an independent field (only via `is_completed` — whether `completed_at` is server-set is **not documented** beyond the read-only field description).

---

## 3. Webhooks / subscriptions

Guide: [Configuring webhooks](https://docs.attio.com/rest-api/guides/webhooks). Event schemas: [api.attio.com/openapi/webhooks](https://api.attio.com/openapi/webhooks).

### Task events (exist)

| Event | Docs | Fires when |
| --- | --- | --- |
| `task.created` | [Task created](https://docs.attio.com/rest-api/webhook-reference/task-events/taskcreated) | “whenever a task is created” |
| `task.updated` | [Task updated](https://docs.attio.com/rest-api/webhook-reference/task-events/taskupdated) | “whenever a task is updated (e.g. the assignees or deadline are changed)” |
| `task.deleted` | [Task deleted](https://docs.attio.com/rest-api/webhook-reference/task-events/taskdeleted) | “whenever a task is deleted” |

**Not documented:** exhaustive list of fields that trigger `task.updated` (content edits in the product UI, completion, linked records). The only examples given are assignees and deadline. No `task.completed` event — completion is an update if it fires `task.updated` (not stated).

### Payload shape

All three events share this envelope (OpenAPI webhooks):

```json
{
  "webhook_id": "23e42eaf-323a-41da-b5bb-fd67eebda553",
  "events": [
    {
      "event_type": "task.created",
      "id": {
        "workspace_id": "14beef7a-99f7-4534-a87e-70b564330a4c",
        "task_id": "649e34f4-c39a-4f4d-99ef-48a36bef8f04"
      },
      "actor": {
        "type": "workspace-member",
        "id": "50cf242c-7fa3-4cad-87d0-75b1af71c57b"
      }
    }
  ]
}
```

- `events` “Currently, each delivery contains exactly one event, but this may change in the future to support batching.”
- **No task body** (no content, deadline, assignees) in the webhook. Handler must `GET /v2/tasks/{task_id}`.
- `actor.id` is nullable; `actor.type` enum matches Task actors including `app`.

### Delivery guarantees, retries, duplicates

From [Configuring webhooks](https://docs.attio.com/rest-api/guides/webhooks):

- **At-least-once.** “Occasionally, due to network instability, Attio may send duplicate messages.”
- **`Idempotency-Key` header:** “different for each message, but the same between retries and redeliveries.”
- Success: HTTP **200–299**. Other status → retry **up to 10 times**, exponential backoff, “over approximately **3 days**”; then webhook marked **degraded** and Attio sends an email.
- **5 second** timeout on the target URL = delivery failure.
- Degraded webhooks still receive events; if degraded **7 days**, status becomes **inactive** and they stop ([Create a webhook](https://docs.attio.com/rest-api/endpoint-reference/webhooks/create-a-webhook) `status` enum: `active` | `degraded` | `inactive`).
- Delivery rate limit: **25 requests/second per target URL** (contact support to change). Distinct from REST rate limits.

**Not documented:** ordering guarantees; whether retries can be reordered; payload identity beyond `Idempotency-Key`.

### Signature verification

- Headers: `Attio-Signature` and duplicate `X-Attio-Signature`.
- Algorithm: **SHA256 HMAC** of the **raw request body** (UTF-8) with the webhook secret; digest **hex**.
- Secret: “viewable inside the developer settings page and in the API response when creating the webhook.” Create response field `secret`: “only shown when setting up the webhook initially.” [Get a webhook](https://docs.attio.com/rest-api/endpoint-reference/webhooks/get-a-webhook) OpenAPI **does not** include `secret`.

Store `secret` at create time. IP allowlist is published but Attio recommends signature verification over IP allowlisting (IPs may change).

### Registering webhooks

Two places ([guide](https://docs.attio.com/rest-api/guides/webhooks)):

1. **API** — `POST /v2/webhooks` ([Create a webhook](https://docs.attio.com/rest-api/endpoint-reference/webhooks/create-a-webhook)), also list/get/patch/delete. Required scope: `webhook:read-write`. `target_url` must match `^https://.*`.
2. **Developer settings UI.** “Webhooks created with tokens that were created through our OAuth sign up flow will **not** be shown in the developer settings page.”

Uniqueness: within a workspace, each subscription must have a unique `(target_url, event_type, filter)`. Duplicate → **409** `uniqueness_conflict`. `null` filter ≡ empty `$and` (matches every event).

Filters (API only to edit/view): `$and` / `$or`; operators `equals` | `not_equals`; `field` supports dotted paths e.g. `actor.type`. Example: only workspace-member actors. Filters are **not** applied when sending **test** events from settings.

V1 webhooks are deprecated; use V2 event names (`task.*` are V2).

### Limitations relevant to sync

- ID-only payloads → extra GET per event (read rate limit).
- 5s handler budget; slow Google Calendar calls should be queued, then 2xx quickly.
- 25 rps/URL smoothing — large bulk edits in Attio will be spread out, not instantaneous.
- Possible future **batching** of `events[]`.
- OAuth-created webhooks hidden from settings UI.

---

## 4. Custom field / metadata for Google Calendar event ID

**Not documented on Task:** custom attributes, metadata, external IDs, or arbitrary extra properties.

Attributes “sit on **objects and lists**” ([Objects and lists](https://docs.attio.com/docs/objects-and-lists)). [Create an attribute](https://docs.attio.com/rest-api/endpoint-reference/attributes/create-an-attribute): “Creates a new attribute on either an object or a list.” Tasks are a first-class REST resource, **not** an object you attach attributes to.

PATCH cannot add a field; it cannot even update `content` to stash an ID.

### Extension points that *are* documented

| Approach | Source | Fit for event IDs |
| --- | --- | --- |
| **Your own mapping store** keyed by `id.task_id` | (integrator-owned; not an Attio API) | Required for a standalone REST integration |
| **App SDK KV Store** | [KV Store](https://docs.attio.com/sdk/server/kv-store) — “cache data, ensure webhook idempotency, or store transient server state”; `get`/`set`/`delete`; optional `ttlInSeconds` | Only if the product is an **Attio App**. Docs describe it as lightweight/transient; **no** documented durability SLA, size limits, or “use this for durable foreign keys” |
| **Workspace settings** | [Defining app settings](https://docs.attio.com/sdk/guides/adding-workspace-settings) | Workspace-level config (e.g. calendar ID), **not** per-task |
| **Connections** | [Authenticating to external services](https://docs.attio.com/sdk/guides/authenticating-to-external-services) | Store Google OAuth tokens (user or workspace), not event IDs |

**Not documented:** using a custom object + record per task as an ID sidecar via Tasks API (you could create a custom object independently; Tasks have no documented link to custom-object records except `linked_records`, and read schema says linked targets are people/companies — see §10).

---

## 5. Auth: OAuth vs API keys, scopes, identity

[Authenticating requests](https://docs.attio.com/rest-api/guides/authentication):

1. **OAuth 2.0** — prefer if the app serves **multiple workspaces**. Tutorial: [Connect an app through OAuth](https://docs.attio.com/rest-api/tutorials/connect-an-app-through-oauth). Authorize: `https://app.attio.com/authorize`; token: `https://app.attio.com/oauth/token` ([Authorize](https://docs.attio.com/docs/oauth/authorize), OpenAPI security schemes).
2. **API key / workspace access token** — “If you are building an app for a **single workspace**, you can manually generate an API key.” Same `Authorization: Bearer` usage. HTTP Basic (token as username, empty password) is supported but Bearer is recommended.

Scopes are the same for OAuth and single-workspace tokens. Task-related:

- `task:read` / `task:read-write` — “View, and optionally write, tasks.”
- List/get also need `object_configuration:read`, `record_permission:read`, `user_management:read`.
- Webhooks: `webhook:read-write`.
- Member emails: `user_management:read`.
- Person emails for attendees: `record_permission:read` (+ `object_configuration:read`).

OAuth scopes are configured in the Developer console; API key scopes in workspace settings (modifiable on existing keys).

### Workspace vs user identity

[Identify](https://docs.attio.com/rest-api/endpoint-reference/meta/identify) `GET /v2/self` (RFC 7662-style):

- Tokens are **workspace-scoped**. `sub` “contains the **workspace_id**” because “Bearer tokens grant **Workspace-level** permissions.”
- `workspace_id`, `workspace_name`, `workspace_slug`, `workspace_logo_url`
- `authorized_by_workspace_member_id` — “who **authorized this token initially**.” Omitted for some app tokens Attio created itself. **Not** “the user making this API call.”
- `exp` is always `null` — “Attio access tokens do not currently expire.”
- Inactive/unknown token: `200` + `{"active": false}`.

Three token kinds: workspace access tokens, OAuth access tokens, App access tokens (`ATTIO_API_TOKEN` in App SDK).

**Not documented:** per-user task ACL on the REST list (the OAuth tutorial fetches `/v2/tasks` with the workspace token and lists tasks). Treat list as **workspace-wide** unless you filter `assignee`.

### Who is the actor?

| Signal | What it tells you |
| --- | --- |
| `GET /v2/self` `authorized_by_workspace_member_id` | Who installed/authorized the token |
| Task `created_by_actor` | Who created that task |
| Webhook `events[].actor` | Who triggered that event |
| `GET /v2/workspace_members/{id}` | `email_address`, names, `access_level` (`admin` \| `member` \| `suspended`) ([Get a workspace member](https://docs.attio.com/rest-api/endpoint-reference/workspace-members/get-a-workspace-member)) |

Members are not hard-deleted: “We do not delete workspace members so that you can successfully attribute past actions to suspended workspace members.”

---

## 6. Rate limits, idempotency, consistency

### REST rate limits

[Handling rate limits](https://docs.attio.com/rest-api/guides/rate-limiting):

- Default: **100 rps reads**, **25 rps writes** across the API.
- May be lowered during incidents or per-endpoint (documented on that endpoint). List notes is temporarily **10 rps** ([changelog](https://docs.attio.com/changelog/rest-api)); **List tasks has no extra limit documented**.
- `429` `rate_limit_error` / `rate_limit_exceeded`; **`Retry-After`** header (HTTP-date). Safe to retry after reset.
- Score-based limits apply to **List records** and **List entries**, not to List tasks.

Webhook delivery 25 rps/URL is separate (§3).

### Idempotency keys (REST)

**Not documented** for `POST/PATCH/DELETE /v2/tasks` (no `Idempotency-Key` request header in the Task OpenAPI). The only documented `Idempotency-Key` is the **webhook delivery** header.

App SDK workflow `uniqueExecutionId` is for workflow blocks, not the REST Tasks API.

### Eventual consistency

**Not documented** for Tasks (no “read-your-writes”, webhook delay, or replication lag notes). Webhook guide presents events as “real-time HTTP requests.” Treat “event then immediately GET” as likely but **not guaranteed** in writing.

Write-record-attribute-values (records/lists, beta) explicitly do **not** fire webhooks; that exception is **not** stated for Tasks.

---

## 7. Official sync / cursor / export for backfill

| Mechanism | Tasks? |
| --- | --- |
| `GET /v2/tasks` limit/offset | **Yes** — only documented bulk read. Default oldest `created_at` first. |
| Cursor pagination | **No** for tasks |
| `updated_at` / sync token / export API | **Not documented** |
| [Query SQL](https://docs.attio.com/rest-api/endpoint-reference/sql/query-sql) `POST /v2/sql` | Enterprise, beta. [Available data](https://docs.attio.com/sql/available-data): “Today **only object and list data** is queryable.” Tasks are neither. |
| Meetings list (cursor) | Calendar **meetings**, not tasks |
| MCP `list-tasks` | AI tool, not a sync cursor |

**Practical backfill:** page `GET /v2/tasks?limit=500&offset=…` (optionally `is_completed=false`). Cannot resume by “changes since last run” from documented fields. After backfill, rely on webhooks + periodic full/open-task reconciliation.

---

## 8. Deadline semantics

Documented facts:

- Field name: **`deadline_at`**.
- Writable type: `string | null`, “in ISO 8601 format.” Create/update **example**: `'2023-01-01T15:00:00.000000000Z'`.
- Readable type: `string | null`. Description: “deadline **date** … ISO 8601 **timestamp**.” **Example: `'2023-01-01'`** (no time).
- Create **requires** the key `deadline_at` (may be JSON `null`).
- Missing deadline: `null` is in the schema. **Not documented:** whether the product UI allows tasks without a deadline (schema allows it).

**Not documented (must be decided in sync design, then verified against live API):**

- Whether stored values are always UTC instants, date-only calendar days, or mixed.
- Timezone of date-only values (workspace TZ vs UTC midnight vs all-day).
- How Google Calendar should map: timed event vs all-day vs skip if `null`.
- Whether a time component of `15:00:00Z` is a real due time or a sentinel.

Do **not** reuse [Date](https://docs.attio.com/rest-api/attribute-types/attribute-types-date) / [Timestamp](https://docs.attio.com/rest-api/attribute-types/attribute-types-timestamp) attribute rules as Task deadline rules; those pages apply to **object/list attributes**, not `deadline_at`. Timestamp attributes: stored UTC, nanosecond precision, UTC assumed if omitted. Date attributes: timezone-less `YYYY-MM-DD`. Task docs mix both wordings.

---

## 9. Completed vs deleted vs archived

| State | How it appears | API |
| --- | --- | --- |
| Open | `is_completed: false`, `completed_at: null` | List `is_completed=false` |
| Completed | `is_completed: true`, `completed_at` set | PATCH `is_completed: true`; list `is_completed=true` |
| Deleted | Resource gone | `DELETE /v2/tasks/{task_id}`; later GET **404**; webhook `task.deleted` |
| Archived | — | **Not on Task schema.** [Archiving vs deleting](https://docs.attio.com/docs/archiving-vs-deleting) defines archive as `is_archived: true` **where that property exists**. Task endpoints do not document `is_archived`. |

Deleting is **permanent**: “Any data you delete will eventually be removed from our servers entirely, without the ability for restoration.”

**Not documented:** whether completing a task fires `task.updated`; whether deleted tasks ever appear in list; undelete.

Sync implication: completion should update/cancel the calendar event, not treat it as delete unless you also receive `task.deleted`.

---

## 10. Linking tasks to people/records (attendees / description)

### Linked records

**Read** ([task schema](https://docs.attio.com/rest-api/endpoint-reference/tasks/get-a-task)):

- `target_object_id` — “The ID of the parent object… At present, **only `people` and `companies` are supported.**” Example: `people`
- `target_record_id` — uuid of the record

**Write** ([Create](https://docs.attio.com/rest-api/endpoint-reference/tasks/create-a-task) / [Update](https://docs.attio.com/rest-api/endpoint-reference/tasks/update-a-task)):

- Match by email (people) / domain (companies), by `target_object` + `target_record_id` (“standard **and custom** objects”), or by unique matching attribute.
- Inline `@` links in content **cannot** be created via API.

**Contradiction:** read says people/companies only; write mentions custom objects. **Not documented** which is current. For attendees, **people** are the only documented email-bearing link.

### People emails for calendar attendees

[People](https://docs.attio.com/docs/standard-objects/standard-objects-people): `email_addresses` is unique, multiselect. Fetch via [Get a person record](https://docs.attio.com/rest-api/endpoint-reference/people/get-a-person-record) (`GET /v2/objects/people/records/{record_id}`), scopes `record_permission:read`, `object_configuration:read`.

Company links have domains, not person emails.

### Assignees vs attendees

Assignees are **workspace members** (internal users), with `email_address` on [workspace members](https://docs.attio.com/rest-api/endpoint-reference/workspace-members/get-a-workspace-member). Linked people are **CRM records**. A sync should treat them separately (event owner/assignee vs guest).

**Not documented:** putting assignee or linked-person emails onto a Google event; any “invite attendees” Task field.

### Description text

Calendar title/description from Attio: `content_plaintext` only (2000-char create cap). Linked records appear as `@record name` in that string plus structured `linked_records`. Extra CRM fields (job title, company name) require extra GETs. Notes/comments are separate APIs, not Task fields.

---

## Source index

| Topic | URL |
| --- | --- |
| Docs index | https://docs.attio.com/llms.txt |
| REST OpenAPI | https://api.attio.com/openapi/api |
| Webhook OpenAPI | https://api.attio.com/openapi/webhooks |
| List / create / get / update / delete tasks | https://docs.attio.com/rest-api/endpoint-reference/tasks/list-tasks — …/create-a-task — …/get-a-task — …/update-a-task — …/delete-a-task |
| Auth, rate limits, pagination, filters, webhooks | https://docs.attio.com/rest-api/guides/authentication — …/rate-limiting — …/pagination — …/filtering-and-sorting — …/webhooks |
| Identify, OAuth | https://docs.attio.com/rest-api/endpoint-reference/meta/identify — https://docs.attio.com/docs/oauth/authorize — https://docs.attio.com/docs/oauth/introspect |
| Actors, archive | https://docs.attio.com/docs/actors — https://docs.attio.com/docs/archiving-vs-deleting |
| Task webhooks | https://docs.attio.com/rest-api/webhook-reference/task-events/taskcreated — …/taskupdated — …/taskdeleted |
| SQL available data | https://docs.attio.com/sql/available-data |
| REST changelog | https://docs.attio.com/changelog/rest-api |

**Explicitly not found in official docs (as of 2026-09-15):** Task `updated_at`; list filter by deadline; REST idempotency keys; Task custom metadata; Task archive; deadline timezone/all-day rules; webhook field-level update catalog; Tasks in SQL; cursor/export sync API for tasks; `developers.attio.com` as a distinct current API reference (it points at docs.attio.com).
