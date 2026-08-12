export declare class SseDecodeError extends Error {
    readonly frame?: string | undefined;
    constructor(message: string, frame?: string | undefined);
}
export declare function readSSEFrames(response: Response, signal?: AbortSignal): AsyncGenerator<string>;
export declare function readSSEJson(response: Response, signal?: AbortSignal): AsyncGenerator<unknown>;
//# sourceMappingURL=sse.d.ts.map