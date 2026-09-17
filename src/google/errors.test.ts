import { describe, expect, it } from "vitest";
import {
  googleErrorMetaFromBody,
  isGoogleCalendarQuota,
} from "./errors";

describe("isGoogleCalendarQuota", () => {
  it.each([
    {
      name: "usageLimits domain is quota",
      meta: { domain: "usageLimits", reason: "rateLimitExceeded", status: null },
      expected: true,
    },
    {
      name: "quotaExceeded reason is quota",
      meta: { domain: null, reason: "quotaExceeded", status: null },
      expected: true,
    },
    {
      name: "RESOURCE_EXHAUSTED status is quota",
      meta: { domain: null, reason: null, status: "RESOURCE_EXHAUSTED" },
      expected: true,
    },
    {
      name: "PERMISSION_DENIED is not quota",
      meta: { domain: null, reason: null, status: "PERMISSION_DENIED" },
      expected: false,
    },
    {
      name: "forbidden reason is not quota",
      meta: { domain: "global", reason: "forbidden", status: null },
      expected: false,
    },
    {
      name: "missing reason is treated as quota",
      meta: { domain: null, reason: null, status: null },
      expected: true,
    },
  ])("$name", ({ meta, expected }) => {
    expect(isGoogleCalendarQuota(403, meta)).toBe(expected);
  });

  it("401 is never quota", () => {
    expect(
      isGoogleCalendarQuota(401, {
        domain: "usageLimits",
        reason: "rateLimitExceeded",
        status: null,
      }),
    ).toBe(false);
  });
});

describe("googleErrorMetaFromBody", () => {
  it("reads Calendar errors[] domain and reason", () => {
    expect(
      googleErrorMetaFromBody({
        error: {
          errors: [{ domain: "usageLimits", reason: "rateLimitExceeded" }],
        },
      }),
    ).toEqual({
      domain: "usageLimits",
      reason: "rateLimitExceeded",
      status: null,
    });
  });

  it("reads token-endpoint error strings", () => {
    expect(googleErrorMetaFromBody({ error: "invalid_grant" })).toEqual({
      domain: null,
      reason: "invalid_grant",
      status: null,
    });
  });
});
