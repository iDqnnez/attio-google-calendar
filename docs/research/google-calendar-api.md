# Google Calendar API v3 — research for Attio Tasks → Calendar sync

Researched 2026-09-15 against current official Google documentation on `developers.google.com`. Primary sources are Calendar API v3 reference and guides under [Google Calendar API](https://developers.google.com/workspace/calendar/api/v3/reference). Do not treat this file as a substitute for those pages.

Scope of this note: one-way **Attio Tasks → Google Calendar events**, designed so **Calendar → Attio** can be added later. Claims are cited. Where official pages disagree, both are quoted.

## Design constraints (read this first)

These facts most constrain a reliable sync. Details and citations are in the numbered sections.

1. **Insert requires only `start` and `end`.** Everything else is optional. `end` is exclusive. Timed vs all-day is an exclusive choice: `date` *or* `dateTime`, never mixed. ([events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars))
2. **Client-chosen `id` is the official idempotent insert mechanism**, but IDs must be unique per calendar, length 5–1024, and **base32hex only** (`a–v` and `0–9`). Collisions are **not guaranteed to be detected**. Re-inserting the same ID returns **409 duplicate**. `id` cannot be changed after insert. ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), [create events](https://developers.google.com/workspace/calendar/api/guides/create-events), [errors](https://developers.google.com/workspace/calendar/api/guides/errors))
3. **Do not use Attio task IDs as Google event `id` unless they already match base32hex.** Store the Attio task ID in **`extendedProperties.private`** (hidden, calendar-local, searchable). Keep a **local mapping** `(attio_task_id ↔ calendarId + event.id + etag)` as well: incremental sync cannot combine `syncToken` with `privateExtendedProperty`, and cancelled events eventually vanish with only `id` guaranteed. ([extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties), [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [events resource `status`](https://developers.google.com/workspace/calendar/api/v3/reference/events))
4. **Concurrent writes: GET then PUT with `If-Match: etag`.** PATCH is partial but costs **three quota units**. PUT replaces the whole resource. `412` means refetch and reapply. Insert has no If-Match; uniqueness of client `id` is the insert precondition. ([version resources](https://developers.google.com/workspace/calendar/api/guides/version-resources), [events.update](https://developers.google.com/workspace/calendar/api/v3/reference/events/update), [events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch))
5. **Push notifications are a wake-up, not a payload.** They do not include the changed event. Expect drops and channel-renewal overlap. Reverse sync must `events.list` with a stored `syncToken`; **410 Gone** means wipe local event state and full-sync. ([push](https://developers.google.com/workspace/calendar/api/guides/push), [sync](https://developers.google.com/workspace/calendar/api/guides/sync))
6. **Deleted events: `404` never existed; `410` already deleted (on delete); list deletions are `status=cancelled`.** Incremental list always includes deletions. Cancelled events are not durable. ([errors](https://developers.google.com/workspace/calendar/api/guides/errors), [events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events))
7. **Avoid recurring events for 1:1 task mapping.** Instances, exceptions, cancelled exceptions that must be kept for the parent’s lifetime, `singleEvents` vs masters, and required IANA timezone for expansion all break a simple task↔event bijection. ([recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents), [Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars))
8. **Scopes: `calendar.events` writes events on calendars the user already has; creating a dedicated calendar needs `calendar`, `calendar.calendars`, or `calendar.app.created`.** `calendar.readonly` / `calendar.events.readonly` cannot write. OAuth identity is the Google Account `sub`; calendar identity is `calendarId` (primary ID *usually* matches email, but email is not a stable user key). ([auth scopes](https://developers.google.com/workspace/calendar/api/auth), [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars))
9. **Quota: 10,000 requests/min/project and 600/min/user/project** (sliding window). `403`/`429` → exponential backoff. PATCH costs 3 units. Watch channels default TTL **604800 s (7 days)** and do not auto-renew. ([quota](https://developers.google.com/workspace/calendar/api/guides/quota), [events.watch](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch))

---

## 1. Event resource

Resource: [`calendar#event`](https://developers.google.com/workspace/calendar/api/v3/reference/events). HTTP base: `https://www.googleapis.com/calendar/v3`.

### Required vs optional on create

[`events.insert`](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) lists **Required Properties** as only:

| Field | Meaning |
| --- | --- |
| `start` | Inclusive start. For a recurring event, start of the first instance. |
| `end` | **Exclusive** end. For a recurring event, end of the first instance. |

[`Create events`](https://developers.google.com/workspace/calendar/api/guides/create-events): “The only two required fields are the `start` and `end` times.”

Optional writable fields relevant to task sync (from the [events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)): `summary`, `description` (HTML allowed), `location`, `status`, `transparency`, `visibility`, `extendedProperties`, `reminders`, `id` (insert only), `sequence`, `colorId`, `eventType` (immutable after create), `recurrence[]`, `attendees[]`, `conferenceData`, `source`, and others not needed for tasks.

Read-only after create (typical): `etag`, `htmlLink`, `created`, `updated`, `creator`, `iCalUID` (on insert; required instead of `id` when importing), `kind`. `id` is writable **only at creation**.

### `start` / `end`: `date` vs `dateTime`

From [Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars):

- **Timed:** `start.dateTime` and `end.dateTime`.
- **All-day:** `start.date` and `end.date` (`yyyy-mm-dd`). “The timezone field has no significance for all-day events.”
- Start and end must both be timed or both all-day. Mixing `start.date` with `end.dateTime` is invalid.

From the [events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events):

- `start` is inclusive; `end` is exclusive.
- `dateTime` is RFC3339. “A time zone offset is required unless a time zone is explicitly specified in `timeZone`.”
- `timeZone` is an IANA name (e.g. `Europe/Zurich`). Required for **recurring** events (expansion zone). Optional for single events (custom zone for start/end).

`endTimeUnspecified` exists (default false); an end time is still provided for compatibility if it is true.

### `status`

Optional. Values ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)):

- `confirmed` — default.
- `tentative`
- `cancelled` — cancelled/deleted.

`events.list` returns cancelled events only on incremental sync (`syncToken` or `updatedMin`) or if `showDeleted=true`. `events.get` always returns them.

Two cancelled meanings:

1. **Cancelled exception of an uncancelled recurring event:** hide that instance. Clients should **store these for the lifetime of the parent**. Only `id`, `recurringEventId`, and `originalStartTime` are guaranteed.
2. **All other cancelled events:** deleted. Clients should **remove local copies**. They **eventually disappear**; do not rely on them indefinitely. Only `id` is guaranteed. Organizer copies (and invitations the user manually removed) may still expose details so they can be restored; incremental sync with `showDeleted=false` will not return those details.

### `extendedProperties`

```
extendedProperties.private  — private to this calendar copy
extendedProperties.shared   — shared across attendees' copies
```

Both are maps of string→string. Writable. See §3.

### `iCalUID` vs `id`

From the [events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events):

- **`id`:** opaque Google Calendar identifier. Client may supply it on insert (see §2). Unique **per calendar**.
- **`iCalUID`:** RFC5545 UID, used to identify events **across calendaring systems**. Required when using [`events.import`](https://developers.google.com/workspace/calendar/api/v3/reference/events/import). “`iCalUID` and the `id` are not identical and only one of them should be supplied at event creation time.”
- Recurring series: all occurrences share one `iCalUID` and have **different** `id`s.
- Lookup: `events.get` by `id`; `events.list?iCalUID=` by iCalendar UID.

[`events.get`](https://developers.google.com/workspace/calendar/api/v3/reference/events/get): “Returns an event based on its Google Calendar ID. To retrieve an event using its iCalendar ID, call the events.list method using the iCalUID parameter.”

### `etag`

ETag of the resource. Changes on every resource change. Used for conditional GET (`If-None-Match` → `304`) and conditional write/delete (`If-Match` → `412` if stale). See §2. ([version resources](https://developers.google.com/workspace/calendar/api/guides/version-resources))

### `sequence`

Writable integer: “Sequence number as per iCalendar.” ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)) Official Calendar docs do not specify increment rules beyond that.

### `transparency`

Optional. ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events))

- `opaque` — default; blocks time (“Busy”).
- `transparent` — does not block time (“Available”).

### `reminders`

Per authenticated user, not shared event data in the iCalendar sense. ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events))

- `reminders.useDefault` — calendar default reminders apply.
- `reminders.overrides[]` — up to **5**; `method` is `email` or `popup`; `minutes` 0–40320 (4 weeks). Required when adding a reminder.
- Changing reminders **does not** update the enclosing event’s `updated` timestamp.

Calendar-level defaults appear on the [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) collection as `defaultReminders`.

### Other fields worth knowing

- `updated` — last modification of **main** event data; reminder-only changes do not bump it.
- `source.url` / `source.title` — “Can only be seen or modified by the creator of the event.” URL must be HTTP or HTTPS. Not a search index like extended properties.
- `eventType` — default `default`. Cannot be changed after create. Other types (`birthday`, `focusTime`, `outOfOffice`, `workingLocation`, `fromGmail`) are not appropriate for task-backed events.
- `locked` — if true, main fields cannot be changed. Read-only.

---

## 2. Create, update, delete

### Create — `POST /calendars/{calendarId}/events`

[`events.insert`](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert). Query params of note: `sendUpdates` (`all` | `externalOnly` | `none`), `conferenceDataVersion` (`0`|`1`), `supportsAttachments`.

**Client-chosen `id` (idempotent insert):**

Rules from the [events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events) / [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert):

- Allowed characters: **base32hex** — lowercase `a–v` and digits `0–9` ([RFC 2938 §3.1.2](https://www.rfc-editor.org/rfc/rfc2938#section-3.1.2)).
- Length **5–1024**.
- Unique **per calendar**.
- “Due to the globally distributed nature of the system, we cannot guarantee that ID collisions will be detected at event creation time.” Google recommends a UUID algorithm ([RFC 4122](https://www.rfc-editor.org/rfc/rfc4122)). A raw RFC 4122 string with hyphens is **not** valid (hyphens are not base32hex). Hex `a–f` without hyphens *is* a subset of `a–v` + `0–9`.
- If omitted, the server generates an `id`.

[`Create events`](https://developers.google.com/workspace/calendar/api/guides/create-events): generating your own ID “enables you to keep entities in your local database in sync with events in Google Calendar. It also prevents duplicate event creation if the operation fails at some point after it is successfully executed in the Calendar backend.” “Some fields, such as the event ID, can only be set during an `events.insert()` operation.”

[Version resources](https://developers.google.com/workspace/calendar/api/guides/version-resources): “There is no support for conditional modifications for insert operations. Instead, it is guaranteed that if you are allowed to provide a resource ID, then the operation will only succeed if no existing entry has that ID.”

**409** if that ID already exists ([errors](https://developers.google.com/workspace/calendar/api/guides/errors)):

```
reason: duplicate
message: The requested identifier already exists.
Suggested action: Generate a new ID if you want to create a new instance, otherwise use the update method call.
```

Retry-after-unknown-success: same client `id` → 409, then `events.get` / `events.update`. That is the documented idempotency story. A 409 is **not** an in-place upsert; it does not apply the new body.

### Update — PUT vs PATCH

| | [`events.update`](https://developers.google.com/workspace/calendar/api/v3/reference/events/update) | [`events.patch`](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch) |
| --- | --- | --- |
| HTTP | `PUT .../events/{eventId}` | `PATCH .../events/{eventId}` |
| Semantics | “Does **not** support patch semantics and always updates the **entire** event resource.” “To do a partial update, perform a `get` followed by an `update` using etags to ensure atomicity.” | Patch semantics. Specified fields replace existing values; unspecified fields unchanged. **Array fields, if specified, overwrite the entire array.** |
| Quota | 1 unit (implied default; PATCH is called out as 3) | “Each patch request consumes **three quota units**; prefer using a `get` followed by an `update`.” |
| Body required | `start` and `end` are listed as required properties on update | Relevant portions only |

Both accept `If-Match` as described next. Both share `sendUpdates`, `conferenceDataVersion`, `supportsAttachments`.

**PUT implication:** sending a partial body on update can **clear** omitted writable fields. GET → modify → PUT with `If-Match` is the documented partial-update path.

**PATCH implication:** good for touching `extendedProperties` without rewriting the event ([extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties) prefers patch). Cost is 3× quota. Arrays (including `recurrence`, `attendees`, reminder overrides) replace wholesale.

`403 forbiddenForNonOrganizer`: shared properties (`guestsCanInviteOthers`, `guestsCanModify`, `guestsCanSeeOtherGuests`) can only be set on the organizer’s copy. Insert/import/update without those fields is treated as setting defaults. Suggested: use patch if you are not the organizer. ([errors](https://developers.google.com/workspace/calendar/api/guides/errors))

### Delete — `DELETE /calendars/{calendarId}/events/{eventId}`

[`events.delete`](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete). Empty body. Success: empty response. Optional `sendUpdates`.

You can also set `status: cancelled` via update (used for recurring instance cancellation in the [recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents) guide).

### `If-Match` / etags

[Get specific versions of resources](https://developers.google.com/workspace/calendar/api/guides/version-resources):

- Every resource has `etag`, which changes every time the resource changes.
- **Conditional modification:** `If-Match: <etag>`. Success returns the new resource + new etag. Otherwise **`412 Precondition Failed`**. Clients should re-get and reapply.
- **Conditional retrieval:** `If-None-Match: <etag>` → new body or **`304 Not Modified`**.
- Insert: no If-Match; client `id` uniqueness is the insert precondition.

[`412`](https://developers.google.com/workspace/calendar/api/guides/errors): `reason: conditionNotMet`, `location: If-Match`. Suggested action: refetch and reapply.

---

## 3. Foreign key (Attio task id) on an event

Goal: reverse sync and dedupe without inventing a Google API.

### `extendedProperties.private` (recommended on-event FK)

[Extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties):

- Hidden key-value metadata “without having to utilize an external database.”
- **Private:** “specific to the `calendarId` and `eventId` used in the request” — local copy only.
- **Shared:** “visible and editable by all attendees”; appear “regardless of the `calendarId` used.”
- Set via insert, update, or patch. Patch is preferred so other keys are left intact. Same key overwrites. Delete a key by patching its value to `null`. Update (PUT) **drops any properties not included**.
- Search: `events.list?privateExtendedProperty=name=value` or `sharedExtendedProperty=name=value`.

Limits (same page):

- Key max **44** characters; longer keys **silently dropped**.
- Value max **1024** characters; longer values **silently truncated**.
- Max **300** properties totaling **32 kB** (keys + values), counting private and shared across all copies.

[`events.list`](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) says repeating `privateExtendedProperty` / `sharedExtendedProperty` returns events that match **all** given constraints. The [extended properties guide](https://developers.google.com/workspace/calendar/api/guides/extended-properties) says repeated constraints of the **same** type are **OR**’d, and private+shared constraints together are **AND**’d. Treat this as an official discrepancy; do not rely on multi-constraint OR/AND without verifying against the live API. Single `privateExtendedProperty=attioTaskId=<id>` is unambiguous.

**Critical for reverse sync:** `syncToken` **cannot** be combined with `privateExtendedProperty`, `sharedExtendedProperty`, `iCalUID`, `orderBy`, `q`, `timeMin`, `timeMax`, or `updatedMin`. ([events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)) Incremental sync therefore **cannot** be “only Attio-tagged events.” Reverse sync must consume **all** changes on that calendar (or use a dedicated calendar so the set is small) and match via local mapping and/or properties on the event body.

### Private vs shared for this product

| | Private | Shared |
| --- | --- | --- |
| Visibility | This calendar copy only | All attendees’ copies; attendees can edit |
| Use if | Event lives on one calendar we control, typically no attendees | Need the FK on every attendee copy |
| Risk | Lost if you only look at a different calendar’s copy | Attendees (or other apps) can change/delete the key |

Task → event on the user’s calendar, no guests: **private**. Shared is for multi-attendee copies, which this sync should avoid (see §10).

### `description`

Optional HTML, user-visible and user-editable. Searchable via `q` ([events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)). Not hidden. Users (and other tools) will rewrite it. Not a FK.

### `source`

Creator-only URL + title. HTTP/HTTPS only. Not listed as a `events.list` filter. Weaker than extended properties for lookup.

### Client-chosen `id` as FK

Officially intended to sync local entities and make insert retries safe ([create events](https://developers.google.com/workspace/calendar/api/guides/create-events)). It is **not** a general-purpose string FK: charset is base32hex; uniqueness is per calendar; collisions may go undetected; `id` is immutable.

**Practical split:**

1. Derive a **base32hex** event `id` for idempotent insert (e.g. lowercase hex of a UUID, no hyphens — still RFC 4122-inspired, charset-legal).
2. Store the **real Attio task id** in `extendedProperties.private` (key ≤ 44 chars).
3. Persist **calendarId + event.id + etag (+ iCalUID)** in our database. That mapping survives cancelled-event expiry and 410 full sync.

---

## 4. Calendar list, primary vs dedicated, `calendarId`

### What a calendar is

[Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars): a calendar is a collection of events plus metadata (summary, default timezone, location). **ID is an email address.** Calendars can be shared.

**Primary calendar:** created automatically per user account. “Its ID usually matches the user's primary email address.” It **cannot be deleted or un-owned** while the account exists. It can still be shared.

**Secondary calendars:** created explicitly; can be modified, deleted, shared. Single **data owner** (initially the creator) with exclusive delete rights; ownership can be transferred in the Calendar UI (and via `calendars.transferOwnership` in Workspace with admin access).

**Do not authenticate as a service account to create a user calendar.** If a service account creates it, the service account is the data owner and ownership cannot be transferred. ([calendars.insert](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert), [Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars))

### Calendars vs CalendarList

| | Calendars | CalendarList |
| --- | --- | --- |
| What | Global calendar objects | The user’s left-rail list + per-user properties (color, default reminders) |
| `insert` | Creates a **secondary** calendar; also added to the creator’s list; creator cannot remove it except by delete/transfer | Adds an **existing** calendar to the user’s list |
| `delete` | Deletes a **secondary** calendar (`calendars.clear` wipes a **primary**) | Unsubscribes from the list |

([Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars), [calendars](https://developers.google.com/workspace/calendar/api/v3/reference/calendars), [calendarList](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList))

[`calendarList` entry](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList): `id`, `primary` (boolean, read-only), `accessRole` (`freeBusyReader` | `reader` | `writerWithoutPrivateAccess` | `writer` | `owner`), `timeZone`, `dataOwner` (email; **set only for secondary calendars**), `defaultReminders`.

`owner` role ≠ data owner: one data owner, many users can have `owner` role.

### How to create a secondary calendar

[`POST https://www.googleapis.com/calendar/v3/calendars`](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert)

Required body: `{ "summary": "<title>" }`. Optional writable metadata on the [Calendars resource](https://developers.google.com/workspace/calendar/api/v3/reference/calendars) includes `description`, `location`, `timeZone` (IANA).

Response is a Calendars resource including `id`. Use that `id` as `calendarId` on event methods.

Scopes for insert: `calendar`, `calendar.app.created`, or `calendar.calendars` ([calendars.insert](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert)). **`calendar.events` is not enough to create a calendar.**

### `calendarId` usage

On event methods ([events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) and siblings):

> Calendar identifier. To retrieve calendar IDs call the calendarList.list method. If you want to access the primary calendar of the currently logged in user, use the "`primary`" keyword.

[`Create events`](https://developers.google.com/workspace/calendar/api/guides/create-events): `calendarId` can be the calendar’s email address **or** `'primary'`. Discover IDs via Calendar UI “Calendar Address” or `calendarList.list`. Ensure write access via `calendarList.get` → `accessRole`.

[`GET /users/me/calendarList`](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list) lists the authenticated user’s calendars.

**Sync implication:** writing to **primary** mixes task events with the user’s real calendar (meetings, OOO, birthdays). Reverse `events.watch` then sees **all** of that. A **dedicated secondary calendar** isolates the collection, simplifies incremental sync and notifications, and matches `calendar.app.created` (narrowest create+write-on-our-calendars scope). Primary is simpler for users who want tasks on the same grid as meetings.

Store the **resolved calendar `id`** (email-form), not only the keyword `primary`. `primary` is a per-user alias; the stable calendar object id is the `id` field.

---

## 5. Watch / push notifications (for later reverse sync)

### How they work

[Push notifications](https://developers.google.com/workspace/calendar/api/guides/push): watch a resource; Calendar POSTs to your HTTPS URL when it changes. Supported: Acl, CalendarList, Events, Settings.

[`POST /calendars/{calendarId}/events/watch`](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch)

Request (reference): `id`, `type` (`web_hook` / `webhook`), `address` (HTTPS), optional `token`, optional `params.ttl`. The [push guide](https://developers.google.com/workspace/calendar/api/guides/push) also documents optional `expiration` as a Unix ms timestamp in the watch body.

Required ([push](https://developers.google.com/workspace/calendar/api/guides/push)):

- `id` unique within the project, max **64** characters (UUID recommended). Echoed as `X-Goog-Channel-Id`.
- `type`: `web_hook`.
- `address`: HTTPS with a **valid** SSL cert. Invalid: self-signed, untrusted CA, revoked, hostname mismatch.
- Current user must own or have access to the resource.

Optional `token` (max 256 chars) → `X-Goog-Channel-Token`. Do not put OAuth tokens in it.

Watch response `200`: `kind: api#channel`, `id`, `resourceId` (stable across API versions), `resourceUri` (version-specific), `token`, `expiration` (Unix ms).

Then Calendar sends a **`sync`** notification (`X-Goog-Resource-State: sync`, `X-Goog-Message-Number: 1`). It may arrive **before** the watch HTTP response. Safe to ignore or use for init.

Later changes: `X-Goog-Resource-State: exists` (create, modify, **or** delete). **No message body.** “These messages do not contain specific information about updated resources, you will need to make another API call to see the full change details.”

Respond `200`/`201`/`202`/`204`/`102` for success. `500`/`502`/`503`/`504` → Calendar retries with exponential backoff if using Google client libraries. Other codes: failure.

User-agent: `APIs-Google`; respects robots.txt.

**Events watches are per-calendar.** Watching calendars A and B requires two channels. CalendarList/Settings are per-user (one collection). Gaining access to a new calendar does **not** notify unless you watch CalendarList and the calendar is added there.

**Reliability:** “Notifications are not 100% reliable. Expect a small percentage of messages to get dropped under normal working conditions. Make sure to handle these missing messages gracefully, so that the application still syncs even if no push messages are received.”

### TTL / expiration

[`events.watch` `params.ttl`](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch): seconds. **Default 604800** (7 days).

[Push](https://developers.google.com/workspace/calendar/api/guides/push): expiration is the more restrictive of your request and Google’s internal limits/defaults. Echoed as `expiration` on the channel and `X-Goog-Channel-Expiration` (human-readable) on each notification.

**No automatic renew.** Replace a channel before expiry with a new `watch` and a **new** `id`. “There’s likely to be an overlap period” with **two active channels** for the same resource → duplicate notifications.

Stop early: [`POST /calendar/v3/channels/stop`](https://developers.google.com/workspace/calendar/api/v3/reference/channels/stop) with `{ "id", "resourceId" }`. Only the creating user+OAuth client (or any user of the same client if a service account created it) can stop it.

### Incremental `events.list` / sync tokens

[Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync) (updated 2026-09-11):

1. **Full sync:** `events.list` (optional filters). Persist `nextSyncToken` from the **last page**. `nextSyncToken` is omitted while `nextPageToken` is present. New events during pagination are not missed; the page token encodes enough to generate a correct sync token.
2. **Incremental sync:** `events.list?syncToken=...`. Result **always contains deleted entries**. If many changes, you get `nextPageToken` instead of `nextSyncToken`; keep the **same** `syncToken` and paginate until a new `nextSyncToken`.
3. Query params must stay consistent. Disallowed with `syncToken`: listed in §3. Mismatch → **400**.
4. **410** on incremental: token expired or related ACLs changed. **Clear client storage and full-sync again.**

[`events.list` `syncToken`](https://developers.google.com/workspace/calendar/api/v3/reference/events/list): same 410 / full sync rule. “All other query parameters should be the same as for the initial synchronization to avoid undefined behavior.”

`maxResults` default 250, cap 2500. Incomplete pages have `nextPageToken`.

`singleEvents=true` expands recurrences into instances and **omits** the underlying recurring event ([events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents)). Sync-token sample code uses `singleEvents=true`; if we avoid recurrence, leave it false.

Legacy `updatedMin` / `updated` sync is “no longer recommended.”

### Full vs incremental vs deleted

| Mode | What you get | Deletions |
| --- | --- | --- |
| Full list, `showDeleted=false` (default) | Current events | Cancelled not included (except cancelled recurring **instances** when `showDeleted` and `singleEvents` are both false) |
| Full list, `showDeleted=true` | Includes `status=cancelled` | See `showDeleted` × `singleEvents` matrix on [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) |
| Incremental `syncToken` | Changed since last token | **Always** included; **cannot** set `showDeleted=false` |
| `updatedMin` | Modified since timestamp | Deleted since then **always** included regardless of `showDeleted` |

On 410 `fullSyncRequired` / `updatedMinTooLongAgo`: wipe store and resync ([errors](https://developers.google.com/workspace/calendar/api/guides/errors)).

Push handler pattern: ignore or ack `sync`; on `exists`, run incremental `events.list` with stored token; persist new token; apply creates/updates; remove locals for cancelled (except recurring exceptions — §9). Also schedule a periodic incremental sync because notifications drop.

---

## 6. OAuth 2 scopes, refresh, identity

### Calendar API scopes

From [Choose Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth) and [OAuth 2.0 Scopes](https://developers.google.com/identity/protocols/oauth2/scopes):

| Scope | Meaning | Typical use here |
| --- | --- | --- |
| `https://www.googleapis.com/auth/calendar.events` | View and edit events on all your calendars | Write/read events on **existing** calendars (including primary) |
| `https://www.googleapis.com/auth/calendar.events.readonly` | View events on all your calendars | Reverse-sync-only (not enough for Attio → Calendar) |
| `https://www.googleapis.com/auth/calendar` | See, edit, share, and permanently delete all calendars you can access | Broad; events + create/delete calendars + ACL |
| `https://www.googleapis.com/auth/calendar.readonly` | See and download any calendar you can access | List calendars; cannot write events |
| `https://www.googleapis.com/auth/calendar.app.created` | Make secondary calendars, and see/create/change/delete events **on them** | Dedicated app calendar without touching the rest of the user’s calendars |
| `https://www.googleapis.com/auth/calendar.calendars` | See/change properties of calendars you have access to, and **create secondary calendars** | Create dedicated calendar without full `calendar` |
| `https://www.googleapis.com/auth/calendar.events.owned` | See/create/change/delete events on calendars **you own** | Narrower than `calendar.events` if we only write owned calendars |

Method-level:

- [`events.insert` / `update` / `patch` / `delete`](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert): `calendar` **or** `calendar.events` **or** `calendar.app.created` **or** `calendar.events.owned`.
- [`events.list` / `watch`](https://developers.google.com/workspace/calendar/api/v3/reference/events/list): those plus readonly variants.
- [`calendars.insert`](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert): `calendar` **or** `calendar.app.created` **or** `calendar.calendars`.

[`Create events`](https://developers.google.com/workspace/calendar/api/guides/create-events) tells you to set scope to `calendar`. The **method reference** also allows `calendar.events`. Prefer the method table; request the **narrowest** set that matches the product choice (primary vs dedicated calendar). Public apps using sensitive scopes need [verification](https://developers.google.com/workspace/calendar/api/auth).

Google’s guidance: request incrementally, at the time of need. ([OAuth 2.0](https://developers.google.com/identity/protocols/oauth2))

### Token refresh

Calendar API uses standard Google OAuth 2.0 ([OAuth 2.0](https://developers.google.com/identity/protocols/oauth2), [web server](https://developers.google.com/identity/protocols/oauth2/web-server)):

- Access tokens are short-lived. Background sync needs a **refresh token**.
- Web server: `access_type=offline` on the authorization request so the code exchange returns `refresh_token`. “The `refresh_token` is only returned on the first authorization.” Store both tokens securely; losing the refresh token forces re-consent.
- Refresh: `POST https://oauth2.googleapis.com/token` with `grant_type=refresh_token` + `refresh_token` + client credentials.
- `401 Invalid Credentials`: get a new access token from the refresh token; if that fails, re-run OAuth. ([errors](https://developers.google.com/workspace/calendar/api/guides/errors))

Refresh tokens **stop working** when ([OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)): user revokes access; unused for **six months**; (Gmail-scoped + password change); too many live refresh tokens; time-based access expired; admin `admin_policy_enforced`. **100 refresh tokens per Google Account per OAuth client ID**; creating another invalidates the oldest **without warning**.

Apps with consent screen **Testing** + external user type: refresh token expires in **7 days** unless scopes are only `openid` / `userinfo.email` / `userinfo.profile`.

Token size limits to tolerate: access tokens up to 2048 bytes, refresh tokens 512 bytes.

Browser GIS token model does **not** issue refresh tokens ([token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)). Server-side sync must use authorization-code + offline access.

### Google identity vs calendar identity

These are different identifiers:

| Identity | What it is | Stability |
| --- | --- | --- |
| **Google Account** | OpenID Connect `sub`: “unique among all Google Accounts and never reused.” Email can change; **do not use email as the user primary key.** Max 255 ASCII. | Stable |
| **OAuth grant** | Refresh/access tokens for **this app + this Google user**. Scopes bound to the token. A Calendar-scoped token does not grant Contacts. | Revocable |
| **Calendar** | `calendarId` (email-form id). Primary id **usually** matches primary email but is a calendar, not the account key. `calendarList.primary` marks the user’s primary calendar. Keyword `primary` means “that user’s primary,” not a global id. | Primary cannot be deleted; email-form id can diverge from current email if Google’s “usually” case does not hold |
| **Event** | `id` unique **per calendar**; `iCalUID` across calendaring systems | `id` immutable; cancelled events expire |

Cite: [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [OIDC reference](https://developers.google.com/identity/openid-connect/reference), [Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars), [calendarList](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList).

Store: `google_sub` (user) + `calendar_id` + `event_id`. Do not key users by calendar email.

---

## 7. Rate limits, 410, 404 vs 410, notification duplicates

### Quota

[Usage limits](https://developers.google.com/workspace/calendar/api/guides/quota) (page notes quota model updates as of **2026-05-01**; projects that used the API Nov 2025–Apr 2026 keep prior quotas):

| Limit | Value |
| --- | --- |
| Per minute per project | 10,000 requests |
| Per minute per user per project | 600 requests |
| Per day per project (billing threshold; no extra charge under it) | 1,000,000 |

Sliding 1-minute window. Burst over quota → rate limiting in the next window.

Exceeding: **`403 usageLimits` or `429 usageLimits`**. Handle both with truncated exponential backoff (example algorithm on that page: `min(((2^n)+random_ms), max_backoff)`).

Also:

- **General Calendar usage limits** (Workspace abuse protection) → `403` `quotaExceeded` “Calendar usage limits exceeded.”
- **Operational limits** (e.g. many writes to one calendar in succession) — “might be limited at any time.”
- PATCH = **3 quota units** ([events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)).
- Domain-wide delegation: by default the **service account** is charged for per-user quota. Set `quotaUser` or `x-goog-quota-user` to the impersonated user.

Anti-patterns from the same page: midnight full syncs; polling every calendar every minute. Prefer push + randomized schedules (±25%).

### 410 Gone (three reasons)

[Handle API errors](https://developers.google.com/workspace/calendar/api/guides/errors):

| `reason` | Meaning | Action |
| --- | --- | --- |
| `fullSyncRequired` | `syncToken` no longer valid | Wipe store, full sync |
| `updatedMinTooLongAgo` | `updatedMin` too far in the past | Wipe store, full sync |
| `deleted` | Delete (or similar) on an **already deleted** event | No further action |

### 404 vs 410 on events

**404 `notFound`:** resource with that ID **never existed**, or the user cannot access the calendar. Suggested action on the errors page is exponential backoff (treat as possibly transient **and** as a real miss).

**410 `deleted`:** already deleted. Idempotent delete: 410 is success-equivalent.

`events.get` on a cancelled event still returns it (with `status=cancelled`) until it disappears ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)). After it disappears, get is 404.

### Duplicates from notifications

Official sources of duplicate or empty wakes:

1. **Channel overlap on renew** — two channels, two POSTs for one change. ([push](https://developers.google.com/workspace/calendar/api/guides/push))
2. **`exists` does not say what changed** — create, update, and delete look the same. Always reconcile via `events.list` + `syncToken`.
3. **Dropped messages** — must not depend on exactly-once delivery; periodic incremental sync.
4. **Non-sequential `X-Goog-Message-Number`** — increasing, not contiguous; `sync` is always `1`.
5. **Idempotent insert 409** — retries after a committed insert.

Dedupe: channel `id` + `resourceId` + incremental sync applying event `id`/`etag` monotonically. Do not create a new Calendar event per webhook.

---

## 8. All-day vs timed; timezones; spanning days

[Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars) + [events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events):

**Timed:** `dateTime` + optional IANA `timeZone`. Equivalent encodings of the same instant:

- Offset in `dateTime` (`2017-01-25T09:00:00-0500`)
- No offset, empty `timeZone` → calendar default zone
- No offset + `timeZone` field
- UTC (`...Z` or `+0000`)

Internal representation is the same; setting `timeZone` attaches a zone as the Calendar UI does.

Single events **may** use different timezones for start and end (e.g. travel). Recurring events **must** use one zone for expansion.

**All-day:** `date` only. Timezone field has **no significance**. `list`/`instances` `timeMin`/`timeMax` interpret all-day bounds using the **calendar** timezone.

**Exclusive end:** a one-day all-day event is `start.date = D`, `end.date = D+1` (see the June 2015 example in [Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars): start `2015-06-01`, end `2015-06-02`). A multi-day all-day event is consecutive dates with exclusive end (span N days → end = start + N days).

**Timed multi-day:** ordinary `dateTime` start/end across midnight or multiple midnights. Still exclusive `end`.

**Query filters ([events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)):** `timeMin` is a **lower bound (exclusive) on the event’s end**; `timeMax` is an **upper bound (exclusive) on the event’s start**. Both require RFC3339 **with mandatory offset**. `timeZone` query param sets the response zone; default is the calendar zone.

Task mapping: if Attio has a date-only due, use all-day (`date`/`date` exclusive). If it has a time, use `dateTime` with an explicit IANA zone (user or calendar `timeZone`), not a floating local timestamp.

---

## 9. Recurring events — avoid for task sync

Google supports RRULE/RDATE/EXDATE on `recurrence[]` ([RFC 5545](https://www.rfc-editor.org/rfc/rfc5545)). `DTSTART`/`DTEND` must **not** appear in `recurrence`; use `start`/`end`. Field omitted for single events and for instances. ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), [Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars))

Why this is a poor 1:1 with Attio tasks:

- One series is many **instances** with distinct `id`s, shared `iCalUID`, `recurringEventId` + `originalStartTime` on instances. ([recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents))
- Default `events.list` returns masters + exceptions, **not** non-exception instances. `singleEvents=true` returns instances and **drops** the master. Free/busy-only callers behave as `singleEvents=true`.
- Exceptions and “this and following” edits are multi-request (trim `UNTIL`/`COUNT`, then insert a new series). “This and following” **resets later exceptions**.
- Cancelled instances must be **kept** for the parent’s lifetime; other cancelled events must be **deleted** locally. ([events resource `status`](https://developers.google.com/workspace/calendar/api/v3/reference/events))
- Recurring events **require** a single IANA `timeZone` on start/end.
- Instance ids are not the series id; a task FK on the master is not on every instance unless copied.

**Recommendation:** create **single** `eventType=default` events only. If Attio later has repeating tasks, either emit separate single events or treat recurrence as a separate design, not as the v1 mapping.

---

## 10. Conference data and attendees (brief)

**Attendees:** writable list; `email` required when adding. The created event appears on attendees’ **primary** calendars with the **same event `id`**. `sendUpdates` controls invitation mail. Service accounts need domain-wide delegation to populate attendees. ([create events](https://developers.google.com/workspace/calendar/api/guides/create-events), [events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events))

Adding attendees turns one task-backed event into many calendar copies, shared extended properties, organizer-only fields, and `403 forbiddenForNonOrganizer`. **Omit attendees** for task blocking time on one calendar.

**Conference / Meet:** `conferenceData` + `conferenceDataVersion=1`. New conferences via `createRequest.requestId` (client-unique; reuse is ignored). Creation is async (`pending` → `success`/`failure`). Reusing Meet conference data across events can leak access. Enabling `conferenceDataVersion=1` on an app that caches events locally requires a **full sync first** or existing conferences may be stripped. ([create events](https://developers.google.com/workspace/calendar/api/guides/create-events), [events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events))

Not required for task → busy block. Skip unless a later product requirement adds Meet.

---

## Suggested mapping (design, not an API)

Not specified by Google; derived from the constraints above:

| Attio | Google Calendar |
| --- | --- |
| Task title | `summary` |
| Due date (date only) | all-day `start.date` / exclusive `end.date` |
| Due datetime | `start.dateTime` / `end.dateTime` + IANA `timeZone` |
| Task id | `extendedProperties.private` + local DB row |
| Idempotent create | client `id` (base32hex) |
| Concurrency | stored `etag` + `If-Match` on PUT |
| Done / deleted task | `events.delete`; treat `410 deleted` as success |
| Busy vs free | `transparency` `opaque` / `transparent` |
| Target calendar | stored `calendarId` (`primary` or secondary `id`) |

---

## Official sources

All retrieved 2026-09-15. Prefer these over this note if they diverge.

### Calendar API v3 reference

- [API reference index](https://developers.google.com/workspace/calendar/api/v3/reference)
- [Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Events: insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Events: get](https://developers.google.com/workspace/calendar/api/v3/reference/events/get)
- [Events: update](https://developers.google.com/workspace/calendar/api/v3/reference/events/update)
- [Events: patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)
- [Events: delete](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete)
- [Events: list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Events: watch](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch)
- [Events: import](https://developers.google.com/workspace/calendar/api/v3/reference/events/import)
- [Events: instances](https://developers.google.com/workspace/calendar/api/v3/reference/events/instances)
- [Calendars resource](https://developers.google.com/workspace/calendar/api/v3/reference/calendars)
- [Calendars: insert](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert)
- [CalendarList resource](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList)
- [CalendarList: list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)
- [Channels: stop](https://developers.google.com/workspace/calendar/api/v3/reference/channels/stop)

### Calendar guides and concepts

- [Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars)
- [Create events](https://developers.google.com/workspace/calendar/api/guides/create-events)
- [Extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties)
- [Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync)
- [Push notifications](https://developers.google.com/workspace/calendar/api/guides/push)
- [Get specific versions of resources](https://developers.google.com/workspace/calendar/api/guides/version-resources)
- [Handle API errors](https://developers.google.com/workspace/calendar/api/guides/errors)
- [Usage limits](https://developers.google.com/workspace/calendar/api/guides/quota)
- [Recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents)
- [Choose Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)

### Identity / OAuth

- [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2)
- [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [OAuth 2.0 Scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes)
- [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [OpenID Connect API reference](https://developers.google.com/identity/openid-connect/reference)
