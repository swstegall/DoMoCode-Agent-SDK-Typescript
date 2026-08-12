export type Cursor = number | string;
export interface CursorPage<T, C extends Cursor = number> {
    items: readonly T[];
    nextCursor?: C;
    done?: boolean;
}
export interface CursorFeedOptions<T, C extends Cursor = number> {
    initialCursor: C;
    fetchPage: (cursor: C, signal: AbortSignal) => Promise<CursorPage<T, C>>;
    cursorOf?: (item: T) => C | undefined;
    pollIntervalMs?: number;
    signal?: AbortSignal;
}
/** A small async iterator for append-only, cursor-addressed feeds. */
export declare class CursorFeed<T, C extends Cursor = number> implements AsyncIterableIterator<T> {
    private readonly controller;
    private readonly fetchPage;
    private readonly cursorOf;
    private readonly pollIntervalMs;
    private readonly items;
    private cursorValue;
    private done;
    private fetching;
    private failure;
    private externalAbort;
    constructor(options: CursorFeedOptions<T, C>);
    get cursor(): C;
    next(): Promise<IteratorResult<T>>;
    return(): Promise<IteratorResult<T>>;
    throw(error?: unknown): Promise<IteratorResult<T>>;
    [Symbol.asyncIterator](): AsyncIterableIterator<T>;
    stop(reason?: unknown): void;
    private fill;
}
export declare function cursorFeed<T, C extends Cursor = number>(options: CursorFeedOptions<T, C>): CursorFeed<T, C>;
//# sourceMappingURL=cursorFeed.d.ts.map