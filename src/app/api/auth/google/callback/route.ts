import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { attioWorkspaceSlug } from "@/attio/identify";
import { attioWebhooks } from "@/attio/webhooks";
import { completeConnect } from "@/connect/complete";
import { prismaConnectionStore } from "@/db/connections";
import {
  appUrl,
  attioEnv,
  attioWebhookTargetUrl,
  connectionTimezone,
  googleOAuthEnv,
} from "@/env";
import { googleDedicatedCalendar } from "@/google/calendars";
import {
  exchangeGoogleAuthorizationCode,
  googleAccountSub,
  GOOGLE_OAUTH_STATE_COOKIE,
} from "@/google/oauth";
import { inngest } from "@/inngest/client";
import { backfillRequested } from "@/inngest/events";

function homeRedirect(error?: string): NextResponse {
  const url = new URL(appUrl());
  if (error != null) {
    url.searchParams.set("error", error);
  }
  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

function statesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("error") != null) {
    return homeRedirect("oauth_denied");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = (await cookies()).get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  if (
    code == null ||
    state == null ||
    expected == null ||
    !statesMatch(state, expected)
  ) {
    return homeRedirect("oauth_state");
  }

  try {
    const oauth = googleOAuthEnv();
    const tokens = await exchangeGoogleAuthorizationCode({
      code,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      redirectUri: oauth.redirectUri,
    });
    const sub = await googleAccountSub(tokens.accessToken);
    const workspaceSlug = await attioWorkspaceSlug(attioEnv().apiToken);
    await completeConnect({
      google: { sub, refreshToken: tokens.refreshToken },
      workspaceSlug,
      timezone: connectionTimezone(),
      webhookTargetUrl: attioWebhookTargetUrl(),
      connections: prismaConnectionStore,
      calendars: googleDedicatedCalendar(tokens.accessToken),
      webhooks: attioWebhooks(attioEnv().apiToken),
      enqueueBackfill: async () => {
        await inngest.send(backfillRequested.create({}));
      },
    });
    return homeRedirect();
  } catch (error) {
    console.error("Google connect failed", error);
    return homeRedirect("connect");
  }
}
