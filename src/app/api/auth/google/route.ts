import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleOAuthEnv } from "@/env";
import { googleAuthorizationUrl, GOOGLE_OAUTH_STATE_COOKIE } from "@/google/oauth";

export async function GET() {
  const { clientId, redirectUri } = googleOAuthEnv();
  const state = randomBytes(32).toString("hex");
  const response = NextResponse.redirect(
    googleAuthorizationUrl({ clientId, redirectUri, state }),
  );
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}
