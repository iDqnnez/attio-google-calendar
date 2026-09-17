import { z } from "zod";
import { mapRemoteHttpToInngest } from "@/inngest/remote-http";

export const GOOGLE_CALENDAR_CREATE_SCOPE =
  "https://www.googleapis.com/auth/calendar.app.created";

export const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().nullish(),
});

const userInfoSchema = z.object({
  sub: z.string(),
});

export function googleAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    `openid ${GOOGLE_CALENDAR_CREATE_SCOPE}`,
  );
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeGoogleAuthorizationCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken: string | null }> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status})`);
  }

  const tokens = tokenResponseSchema.parse(await response.json());
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
  };
}

export async function googleAccountSub(accessToken: string): Promise<string> {
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) {
    throw new Error(`Google userinfo failed (${response.status})`);
  }
  return userInfoSchema.parse(await response.json()).sub;
}

export async function refreshGoogleAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw (
      mapRemoteHttpToInngest({
        source: "google-token",
        status: response.status,
        retryAfter: response.headers.get("Retry-After"),
      }) ?? new Error(`Google token refresh failed (${response.status})`)
    );
  }
  return tokenResponseSchema.parse(await response.json()).access_token;
}
