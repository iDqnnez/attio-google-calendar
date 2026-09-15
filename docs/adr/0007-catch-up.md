# Catch-up lists Open Tasks and re-fetches Bound Tasks

Attio webhooks are at-least-once, can degrade, then go inactive. Tasks have no `updated_at` and no deadline filter. Catch-up lists Open Tasks and client-filters Qualifying ones, and re-fetches every Task that already has a Binding (so missed Completion, Deletion, and cleared Deadlines are visible). It does not list completed history that was never Bound. Live Projection stays on webhooks; Catch-up is hourly reconciliation through the same worker.
