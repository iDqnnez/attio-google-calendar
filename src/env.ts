function required(name: string): string {
  const value = process.env[name];
  if (value == null || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function appUrl(): string {
  return required("APP_URL").replace(/\/$/, "");
}

/** Attio webhook target; appends Vercel protection bypass when present. */
export function attioWebhookTargetUrl(): string {
  const url = new URL(`${appUrl()}/api/webhooks/attio`);
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass != null && bypass !== "") {
    url.searchParams.set("x-vercel-protection-bypass", bypass);
  }
  return url.toString();
}

export function googleOAuthEnv(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  return {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    redirectUri: `${appUrl()}/api/auth/google/callback`,
  };
}

export function attioEnv(): { apiToken: string } {
  return { apiToken: required("ATTIO_API_TOKEN") };
}

export function connectionTimezone(): string {
  return required("CONNECTION_TIMEZONE");
}

