import { z } from "zod";

const identifySchema = z.discriminatedUnion("active", [
  z.object({ active: z.literal(false) }),
  z.object({
    active: z.literal(true),
    workspace_slug: z.string(),
  }),
]);

export async function attioWorkspaceSlug(apiToken: string): Promise<string> {
  const response = await fetch("https://api.attio.com/v2/self", {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!response.ok) {
    throw new Error(`Attio identify failed (${response.status})`);
  }

  const identity = identifySchema.parse(await response.json());
  if (!identity.active) {
    throw new Error("Attio workspace token is inactive");
  }
  return identity.workspace_slug;
}
