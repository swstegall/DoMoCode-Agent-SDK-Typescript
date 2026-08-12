export interface ErrorHint {
    code: string;
    text: string;
}
export declare class DoMoError extends Error {
    readonly cause?: unknown;
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
export declare class WireValidationError extends DoMoError {
    readonly value: unknown;
    constructor(message: string, value: unknown);
}
export interface ApiErrorOptions {
    status: number;
    route: string;
    body?: string;
    hint?: ErrorHint;
    cause?: unknown;
}
export declare class DoMoApiError extends DoMoError {
    readonly status: number;
    readonly route: string;
    readonly body: string | undefined;
    readonly hint: ErrorHint | undefined;
    constructor(message: string, options: ApiErrorOptions);
    toString(): string;
}
export declare class UnauthorizedError extends DoMoApiError {
    constructor(options: ApiErrorOptions);
}
export declare class ForbiddenError extends DoMoApiError {
    constructor(options: ApiErrorOptions);
}
export declare class NotFoundError extends DoMoApiError {
    constructor(options: ApiErrorOptions);
}
export declare class ConflictError extends DoMoApiError {
    constructor(options: ApiErrorOptions);
}
export declare class PayloadTooLargeError extends DoMoApiError {
    constructor(options: ApiErrorOptions);
}
export declare class StoreBusyError extends ConflictError {
    constructor(options: ApiErrorOptions);
}
export declare class RequestTimeoutError extends DoMoError {
    readonly route: string;
    constructor(route: string, options?: {
        cause?: unknown;
    });
}
export declare class AttachRejectedError extends DoMoApiError {
    readonly sessionId: string;
    constructor(sessionId: string, options: ApiErrorOptions);
}
export declare function redactSecrets(value: string): string;
//# sourceMappingURL=errors.d.ts.map