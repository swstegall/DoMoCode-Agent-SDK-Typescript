import type { FetchFunction } from "../transport.ts";
export interface FaultInjectorOptions {
    /** Split every response body into chunks no larger than this many bytes. */
    chunkSize?: number;
    /** Delay each injected chunk by this many milliseconds. */
    delayMs?: number;
    /** Close a response after this many body bytes, simulating a dropped stream. */
    truncateAfterBytes?: number;
}
export interface FaultInjectorStats {
    requests: number;
    responses: number;
    bytes: number;
    truncated: number;
}
/**
 * Deterministic response-stream faults for protocol and reconnect tests.
 *
 * It deliberately wraps the platform fetch seam rather than depending on a
 * server, proxy, or test-only HTTP library. A one-byte chunk size exercises
 * UTF-8 and SSE delimiter boundaries that normal fetch implementations often
 * hide behind much larger network buffers.
 */
export declare class FaultInjector {
    private readonly chunkSize;
    private readonly delayMs;
    private readonly truncateAfterBytes;
    private counters;
    constructor(options?: FaultInjectorOptions);
    get stats(): FaultInjectorStats;
    reset(): void;
    fetch(baseFetch: FetchFunction): FetchFunction;
}
//# sourceMappingURL=fault-injector.d.ts.map