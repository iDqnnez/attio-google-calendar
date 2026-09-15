# Connect creates the Calendar, Attio webhook, and Backfill

After Google OAuth, connect creates the dedicated Calendar named `Attio Tasks`, registers Attio webhooks for `task.created`, `task.updated`, and `task.deleted` at `{APP_URL}/api/webhooks/attio`, and enqueues Backfill. The Attio workspace token is already in env. Re-connect reuses Calendar and webhook rows in Postgres instead of duplicating them. Manual Calendar/webhook setup is extra Operator work with no benefit for a one-Connection deploy.
