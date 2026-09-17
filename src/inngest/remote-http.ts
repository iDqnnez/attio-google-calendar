import { NonRetriableError, RetryAfterError } from "inngest";

export type RemoteHttpSource = "attio" | "google-token" | "google-calendar";

export type RemoteHttpFailure = {
  source: RemoteHttpSource;
  status: number;
  retryAfter: string | null;
  quota?: boolean;
};

export function retryAfterFromHeader(header: string | null): number | Date {
  if (header == null || header === "") {
    return 60_000;
  }
  if (/^\d+$/.test(header)) {
    return Number(header) * 1000;
  }
  return new Date(header);
}

export function mapRemoteHttpToInngest(
  failure: RemoteHttpFailure,
): RetryAfterError | NonRetriableError | null {
  if (failure.status === 429) {
    return rateLimited(failure);
  }

  if (failure.source === "google-calendar") {
    if (failure.status === 401) {
      return new NonRetriableError("Google Calendar credentials rejected", {
        cause: failure,
      });
    }
    if (failure.status === 403) {
      return failure.quota === false
        ? new NonRetriableError("Google Calendar access denied", {
            cause: failure,
          })
        : rateLimited(failure);
    }
    return null;
  }

  if (failure.source === "google-token") {
    if (
      failure.status === 400 ||
      failure.status === 401 ||
      failure.status === 403
    ) {
      return new NonRetriableError(
        `Google token refresh failed (${failure.status})`,
        { cause: failure },
      );
    }
    return null;
  }

  if (failure.status === 401 || failure.status === 403) {
    return new NonRetriableError(`Attio request failed (${failure.status})`, {
      cause: failure,
    });
  }
  return null;
}

function rateLimited(failure: RemoteHttpFailure): RetryAfterError {
  const label =
    failure.source === "attio" ? "Attio rate limited" : "Google rate limited";
  return new RetryAfterError(label, retryAfterFromHeader(failure.retryAfter), {
    cause: failure,
  });
}
