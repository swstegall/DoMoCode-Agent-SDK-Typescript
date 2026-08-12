/** A small async iterator for append-only, cursor-addressed feeds. */
export class CursorFeed {
    controller = new AbortController();
    fetchPage;
    cursorOf;
    pollIntervalMs;
    items = [];
    cursorValue;
    done = false;
    fetching;
    failure;
    externalAbort;
    constructor(options) {
        if (!Number.isFinite(options.pollIntervalMs ?? 1_000) || (options.pollIntervalMs ?? 1_000) < 0) {
            throw new TypeError("Cursor feed pollIntervalMs must be a finite, non-negative number");
        }
        this.cursorValue = options.initialCursor;
        this.fetchPage = options.fetchPage;
        this.cursorOf = options.cursorOf;
        this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
        if (options.signal) {
            const abort = () => this.stop(options.signal?.reason);
            this.externalAbort = abort;
            if (options.signal.aborted)
                abort();
            else
                options.signal.addEventListener("abort", abort, { once: true });
        }
    }
    get cursor() { return this.cursorValue; }
    async next() {
        if (this.items.length > 0) {
            return { done: false, value: this.items.shift() };
        }
        if (this.done) {
            if (this.failure !== undefined)
                throw this.failure;
            return { done: true, value: undefined };
        }
        if (!this.fetching)
            this.fetching = this.fill();
        await this.fetching;
        this.fetching = undefined;
        return this.next();
    }
    async return() {
        this.stop();
        return { done: true, value: undefined };
    }
    async throw(error) {
        this.stop(error);
        throw error;
    }
    [Symbol.asyncIterator]() { return this; }
    stop(reason) {
        if (this.done)
            return;
        this.done = true;
        this.failure = reason;
        this.controller.abort(reason);
    }
    async fill() {
        while (!this.done && this.items.length === 0) {
            try {
                const page = await this.fetchPage(this.cursorValue, this.controller.signal);
                if (!Array.isArray(page.items))
                    throw new TypeError("Cursor feed pages require an items array");
                this.items.push(...page.items);
                const pageCursor = page.nextCursor;
                const itemCursor = this.items.length > 0 && this.cursorOf ? this.cursorOf(this.items[this.items.length - 1]) : undefined;
                if (pageCursor !== undefined)
                    this.cursorValue = pageCursor;
                else if (itemCursor !== undefined)
                    this.cursorValue = itemCursor;
                if (page.done === true)
                    this.done = true;
                if (this.items.length === 0 && !this.done)
                    await delay(this.pollIntervalMs, this.controller.signal);
            }
            catch (error) {
                if (this.done && this.failure !== undefined)
                    return;
                if (isAbortError(error) && this.controller.signal.aborted) {
                    this.done = true;
                    this.failure = this.failure ?? this.controller.signal.reason;
                    return;
                }
                this.done = true;
                this.failure = error;
                return;
            }
        }
    }
}
export function cursorFeed(options) {
    return new CursorFeed(options);
}
async function delay(milliseconds, signal) {
    if (milliseconds === 0) {
        signal.throwIfAborted();
        return;
    }
    await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, milliseconds);
        const abort = () => {
            clearTimeout(timer);
            reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
        };
        if (signal.aborted)
            abort();
        else
            signal.addEventListener("abort", abort, { once: true });
    });
}
function isAbortError(error) {
    return error instanceof DOMException && error.name === "AbortError";
}
//# sourceMappingURL=cursorFeed.js.map