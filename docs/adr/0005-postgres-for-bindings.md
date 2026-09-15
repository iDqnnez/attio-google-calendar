# Bindings and Google tokens live in Postgres

Inngest orchestrates Projection; it is not the Binding store. Bindings, etags, Calendar id, and the Google refresh token persist in Postgres via `DATABASE_URL`. SQLite does not fit Vercel serverless. KV is not a documented mapping store and is the wrong durability story for Heal and Catch-up.
