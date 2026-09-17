const QUOTA_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
]);

export type GoogleErrorMeta = {
  domain: string | null;
  reason: string | null;
  status: string | null;
};

export class GoogleHttpError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;
  readonly quota: boolean;

  constructor(
    status: number,
    retryAfter: string | null = null,
    quota: boolean = status === 403,
  ) {
    super(`Google Calendar request failed (${status})`);
    this.name = "GoogleHttpError";
    this.status = status;
    this.retryAfter = retryAfter;
    this.quota = quota;
  }
}

export function isGoogleCalendarQuota(
  httpStatus: number,
  meta: GoogleErrorMeta,
): boolean {
  if (httpStatus !== 403) {
    return false;
  }
  if (meta.status === "RESOURCE_EXHAUSTED") {
    return true;
  }
  if (meta.status === "PERMISSION_DENIED") {
    return false;
  }
  if (meta.domain === "usageLimits") {
    return true;
  }
  if (meta.reason != null && QUOTA_REASONS.has(meta.reason)) {
    return true;
  }
  return meta.domain == null && meta.reason == null && meta.status == null;
}

export function googleErrorMetaFromBody(body: unknown): GoogleErrorMeta {
  if (body == null || typeof body !== "object") {
    return { domain: null, reason: null, status: null };
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") {
    return { domain: null, reason: error, status: null };
  }
  if (error == null || typeof error !== "object") {
    return { domain: null, reason: null, status: null };
  }
  const record = error as {
    errors?: Array<{ domain?: unknown; reason?: unknown }>;
    domain?: unknown;
    reason?: unknown;
    status?: unknown;
  };
  const first = record.errors?.[0];
  return {
    domain: stringOrNull(first?.domain) ?? stringOrNull(record.domain),
    reason: stringOrNull(first?.reason) ?? stringOrNull(record.reason),
    status: stringOrNull(record.status),
  };
}

export async function googleHttpErrorFromResponse(
  response: Response,
): Promise<GoogleHttpError> {
  const retryAfter = response.headers.get("Retry-After");
  const meta = googleErrorMetaFromBody(await readJsonBody(response));
  return new GoogleHttpError(
    response.status,
    retryAfter,
    isGoogleCalendarQuota(response.status, meta),
  );
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
