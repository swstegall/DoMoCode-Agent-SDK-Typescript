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
//# sourceMappingURL=errors.d.ts.map