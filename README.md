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

`ATTIO_API_TOKEN` needs `task:read`, `object_configuration:read`, `record_permission:read`, `user_management:read`, and `webhook:read-write`. It does not need `task:read-write`.

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

## Security

This instance is for one Operator. The app itself does not log anyone in: `/` and Connect are open routes, so the deployment is gated at the host (Vercel Authentication on all URLs). Inngest and Attio reach the machine paths with a shared bypass; Attio deliveries are still accepted only when the HMAC signature matches the stored webhook secret. Inngest invokes `/api/inngest` with its signing key. Google Connect is limited by OAuth Testing to the Operator’s account. Secrets stay in server env; the Calendar is a one-way Projection, so Calendar edits never write back to Attio.

## Deploy

One Operator per instance. Typical path: Vercel + Postgres (e.g. Neon) + Inngest Vercel integration.

1. Push the repo and import it as a Vercel project.
2. Create Postgres and set Production env: `DATABASE_URL`, `ATTIO_API_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CONNECTION_TIMEZONE`, `APP_URL` (the production origin, no trailing slash). Omit `INNGEST_DEV`.
3. Install the Inngest Vercel integration so `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are set and `/api/inngest` syncs on deploy.
4. Deploy, then migrate: `DATABASE_URL=… npx prisma migrate deploy`.
5. Before Connect, enable [Deployment Protection](https://vercel.com/docs/deployment-protection): **Vercel Authentication**, scope **All Deployments**. Enable [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation); paste the secret into the Inngest Vercel integration.
6. Add the Google OAuth redirect `{APP_URL}/api/auth/google/callback`. Keep the consent screen in **Testing** with only the Operator’s Google account as a test user.
7. Open the site (after Vercel login) and Connect Google.
8. Connect registers `{APP_URL}/api/webhooks/attio`. Update that Attio webhook target to `{APP_URL}/api/webhooks/attio?x-vercel-protection-bypass={secret}` so Attio can POST under protection. `Attio-Signature` still gates the route.
