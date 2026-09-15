export class GoogleHttpError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;

  constructor(status: number, retryAfter: string | null = null) {
    super(`Google Calendar request failed (${status})`);
    this.name = "GoogleHttpError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
