import { NonRetriableError, RetryAfterError } from "inngest";
import { describe, expect, it } from "vitest";
import { mapRemoteHttpToInngest } from "./remote-http";

describe("mapRemoteHttpToInngest", () => {
  it.each([
    {
      name: "Attio 429 waits for Retry-After",
      failure: { source: "attio" as const, status: 429, retryAfter: "120" },
      expected: { type: RetryAfterError, retryAfter: "120" },
    },
    {
      name: "Attio 401 is permanent",
      failure: { source: "attio" as const, status: 401, retryAfter: null },
      expected: { type: NonRetriableError },
    },
    {
      name: "Attio 403 is permanent",
      failure: { source: "attio" as const, status: 403, retryAfter: null },
      expected: { type: NonRetriableError },
    },
    {
      name: "Attio 500 stays a normal retry",
      failure: { source: "attio" as const, status: 500, retryAfter: null },
      expected: { type: null },
    },
    {
      name: "Google token 400 invalid_grant is permanent",
      failure: {
        source: "google-token" as const,
        status: 400,
        retryAfter: null,
      },
      expected: { type: NonRetriableError },
    },
    {
      name: "Google token 401 is permanent",
      failure: {
        source: "google-token" as const,
        status: 401,
        retryAfter: null,
      },
      expected: { type: NonRetriableError },
    },
    {
      name: "Google token 429 waits for Retry-After",
      failure: {
        source: "google-token" as const,
        status: 429,
        retryAfter: "30",
      },
      expected: { type: RetryAfterError, retryAfter: "30" },
    },
    {
      name: "Calendar 401 is permanent",
      failure: {
        source: "google-calendar" as const,
        status: 401,
        retryAfter: null,
      },
      expected: { type: NonRetriableError },
    },
    {
      name: "Calendar 403 quota waits",
      failure: {
        source: "google-calendar" as const,
        status: 403,
        retryAfter: null,
        quota: true,
      },
      expected: { type: RetryAfterError, retryAfter: "60" },
    },
    {
      name: "Calendar 403 without a reason waits (assume quota)",
      failure: {
        source: "google-calendar" as const,
        status: 403,
        retryAfter: null,
      },
      expected: { type: RetryAfterError, retryAfter: "60" },
    },
    {
      name: "Calendar 403 forbidden is permanent",
      failure: {
        source: "google-calendar" as const,
        status: 403,
        retryAfter: null,
        quota: false,
      },
      expected: { type: NonRetriableError },
    },
    {
      name: "Calendar 409 stays unmapped so Heal can run",
      failure: {
        source: "google-calendar" as const,
        status: 409,
        retryAfter: null,
      },
      expected: { type: null },
    },
  ])("$name", ({ failure, expected }) => {
    const mapped = mapRemoteHttpToInngest(failure);
    if (expected.type == null) {
      expect(mapped).toBeNull();
      return;
    }
    expect(mapped).toBeInstanceOf(expected.type);
    if (expected.retryAfter != null) {
      expect(mapped).toMatchObject({ retryAfter: expected.retryAfter });
    }
  });
});
