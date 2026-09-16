# Attio Google Calendar

Projects [Attio](https://attio.com) Tasks onto a dedicated Google Calendar named `Attio Tasks`. Attio is Authority; the Calendar is a one-way Projection.

## What is projected

A **Qualifying Task** — a Task with a Deadline, from anyone in the workspace — becomes one all-day **Event** on the civil date of that Deadline in the **Connection timezone**. The Event title is the Task content. The description is the Task URL:

`https://app.attio.com/{workspace_slug}/tasks?id={task_id}&command-menu-page=task`

A Task with no Deadline is not projected.

## What is not

- Calendar changes are never written back to Attio.
- First connect Backfills only **Open** Qualifying Tasks. Completed history that was never Bound stays off the Calendar.

## Completion, Deletion, Heal, Catch-up

- **Completion**: the Event stays. Title and date still follow Attio.
- **Deletion**: the Event is removed and the Binding ends.
- **Heal**: a missing Event is created again. Deleting an Event on the Calendar does not stick.
- **Catch-up**: hourly. It projects Open Qualifying Tasks and every Task that already has a Binding, so missed creates, updates (including Completion), Deletions, cleared Deadlines, and Heal are repaired.

## Environment

| Variable | Role |
| --- | --- |
| `ATTIO_API_TOKEN` | Attio workspace access token |
| `GOOGLE_CLIENT_ID` | Google OAuth client |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client |
| `CONNECTION_TIMEZONE` | IANA timezone used to turn a Deadline into a civil date |
| `APP_URL` | Public origin of this instance |
| `DATABASE_URL` | Postgres |
| `INNGEST_DEV` | `1` locally; omit in production |
| `INNGEST_EVENT_KEY` | Production Inngest (Vercel integration) |
| `INNGEST_SIGNING_KEY` | Production Inngest (Vercel integration) |

Google OAuth redirect URI: `{APP_URL}/api/auth/google/callback`. The client needs a scope that can create a Calendar (`calendar.app.created` or `calendar`).

Copy `.env.example` to `.env.local` and fill the values.

## Connect

Open `/api/auth/google` (the **Connect Google** link on the home page). After OAuth, connect creates the `Attio Tasks` Calendar, registers Attio webhooks at `{APP_URL}/api/webhooks/attio`, and Backfills Open Qualifying Tasks. Re-connect reuses the stored Calendar and webhook.

```bash
npm install
npx prisma migrate deploy
npm run dev
```

## Local Inngest

Set `INNGEST_DEV=1` (already in `.env.example`). Inngest `serve()` is at `/api/inngest` (GET/POST/PUT). Point the Inngest Dev Server at `http://localhost:3000/api/inngest`:

```bash
npx inngest-cli@latest dev
```

## Vercel

On Vercel, `maxDuration` on `/api/inngest` and `checkpointing.maxRuntime` on the Inngest client are required. This repo sets `maxDuration = 300` and `checkpointing.maxRuntime = "240s"`. Do not leave `maxRuntime` at the unlimited default.
