import { type ServerEvent } from "./types/events.ts";
export declare class ProtocolMismatchError extends Error {
    readonly received: number;
    readonly expected: number;
    constructor(received: number, expected: number);
}
export declare class EventStreamError extends Error {
    readonly status?: number | undefined;
    constructor(message: string, status?: number | undefined);
}
export declare class EventStreamWatchdogError extends EventStreamError {
    constructor();
}
export interface EventEngineStats {
    reconnects: number;
    lastSequence: number;
    lagged: number;
    connected: number;
    heartbeats: number;
}
export type EventListener = (event: ServerEvent) => void;
export interface EventEngineOptions {
    open: (after: number, signal: AbortSignal) => Promise<Response>;
    reconcile?: (signal: AbortSignal) => Promise<unknown[]>;
    revive?: (signal: AbortSignal) => Promise<void>;
    protocolVersion?: number;
    heartbeatTimeoutMs?: number;
    initialBackoffMs?: number;
    maximumBackoffMs?: number;
    queueSize?: number;
    onLagged?: (count: number) => void;
}
/** A reconnecting, sequence-aware consumer for one DoMoCode SSE stream. */
export declare class EventEngine implements AsyncIterableIterator<ServerEvent> {
    readonly stats: EventEngineStats;
    private readonly options;
    private readonly queue;
    private readonly reconciledInteractions;
    private readonly listeners;
    private readonly stopped;
    private started;
    private runPromise;
    constructor(options: EventEngineOptions);
    get lastSequence(): number;
    onEvent(listener: EventListener): () => void;
    start(): void;
    stop(): Promise<void>;
    next(): Promise<IteratorResult<ServerEvent>>;
    return(): Promise<IteratorResult<ServerEvent>>;
    [Symbol.asyncIterator](): AsyncIterableIterator<ServerEvent>;
    private run;
    private consume;
    private publish;
}
//# sourceMappingURL=eventEngine.d.ts.map