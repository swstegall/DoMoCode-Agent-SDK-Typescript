export interface ErrorHint { code: string; text: string }

export class DoMoError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DoMoError";
    this.cause = options?.cause;
  }
}

export class WireValidationError extends DoMoError {
  readonly value: unknown;
  constructor(message: string, value: unknown) {
    super(message);
    this.name = "WireValidationError";
    this.value = value;
  }
}

export interface ApiErrorOptions {
  status: number;
  route: string;
  body?: string;
  hint?: ErrorHint;
  cause?: unknown;
}

export class DoMoApiError extends DoMoError {
  readonly status: number;
  readonly route: string;
  readonly body: string | undefined;
  readonly hint: ErrorHint | undefined;

  constructor(message: string, options: ApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "DoMoApiError";
    this.status = options.status;
    this.route = options.route;
    this.body = options.body;
    this.hint = options.hint;
  }

  override toString(): string {
    const detail = this.body ? `: ${redactSecrets(this.body)}` : "";
    return `${this.name} ${this.status} ${this.route}${detail}`;
  }
}

export class UnauthorizedError extends DoMoApiError {
  constructor(options: ApiErrorOptions) { super("DoMoCode rejected the bearer token.", options); this.name = "UnauthorizedError"; }
}

export class ForbiddenError extends DoMoApiError {
  constructor(options: ApiErrorOptions) { super("DoMoCode refused the operation.", options); this.name = "ForbiddenError"; }
}

export class NotFoundError extends DoMoApiError {
  constructor(options: ApiErrorOptions) { super("DoMoCode could not find the requested resource.", options); this.name = "NotFoundError"; }
}

export class ConflictError extends DoMoApiError {
  constructor(options: ApiErrorOptions) { super("DoMoCode reported a state conflict.", options); this.name = "ConflictError"; }
}

export class PayloadTooLargeError extends DoMoApiError {
  constructor(options: ApiErrorOptions) { super("The request body exceeds the DoMoCode limit.", options); this.name = "PayloadTooLargeError"; }
}

export class StoreBusyError extends ConflictError {
  constructor(options: ApiErrorOptions) { super(options); this.name = "StoreBusyError"; }
}

export class RequestTimeoutError extends DoMoError {
  readonly route: string;
  constructor(route: string, options?: { cause?: unknown }) { super(`DoMoCode request timed out: ${route}`, options); this.name = "RequestTimeoutError"; this.route = route; }
}

export class AttachRejectedError extends DoMoApiError {
  readonly sessionId: string;
  constructor(sessionId: string, options: ApiErrorOptions) { super("The session was created but ledger attachment was rejected.", options); this.name = "AttachRejectedError"; this.sessionId = sessionId; }
}

export function redactSecrets(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|api[_-]?key)=)[^&\s]+/gi, "$1[REDACTED]");
}
