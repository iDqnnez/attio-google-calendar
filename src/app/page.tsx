import { prisma } from "@/db/prisma";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const connections = await prisma.connection.findMany({
    select: {
      googleAccountSub: true,
      calendarId: true,
      workspaceSlug: true,
    },
  });

  return (
    <main>
      <h1>Attio Tasks Calendar</h1>
      {error != null ? <p>Could not complete Google connect ({error}).</p> : null}
      {connections.length === 0 ? (
        <p>No Connection yet.</p>
      ) : (
        <ul>
          {connections.map((connection) => (
            <li key={connection.googleAccountSub}>
              Workspace {connection.workspaceSlug} · Calendar{" "}
              {connection.calendarId}
            </li>
          ))}
        </ul>
      )}
      <p>
        <a href="/api/auth/google">Connect Google</a>
      </p>
    </main>
  );
}
