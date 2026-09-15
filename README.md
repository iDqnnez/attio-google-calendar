# Attio Google Calendar

Projects [Attio](https://attio.com) tasks onto a dedicated Google calendar.

## Local development

```bash
cp .env.example .env.local
# Set DATABASE_URL to a Postgres database. INNGEST_DEV=1 is already in the example.
npm install
npx prisma migrate deploy
npm run dev
```

Inngest `serve()` is at `/api/inngest` (GET/POST/PUT). Point the Inngest Dev Server at `http://localhost:3000/api/inngest`.
