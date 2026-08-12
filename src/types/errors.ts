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
