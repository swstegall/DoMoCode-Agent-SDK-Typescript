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
export class CursorFeed<T, C extends Cursor = number> implements AsyncIterableIterator<T> {
  private readonly controller = new AbortController();
  private readonly fetchPage: CursorFeedOptions<T, C>["fetchPage"];
  private readonly cursorOf: CursorFeedOptions<T, C>["cursorOf"];
  private readonly pollIntervalMs: number;
  private readonly items: T[] = [];
  private cursorValue: C;
  private done = false;
  private fetching: Promise<void> | undefined;
  private failure: unknown;
  private externalAbort: (() => void) | undefined;

  constructor(options: CursorFeedOptions<T, C>) {
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
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }
  }

  get cursor(): C { return this.cursorValue; }

  async next(): Promise<IteratorResult<T>> {
    if (this.items.length > 0) {
      return { done: false, value: this.items.shift() as T };
    }
    if (this.done) {
      if (this.failure !== undefined) throw this.failure;
      return { done: true, value: undefined };
    }
    if (!this.fetching) this.fetching = this.fill();
    await this.fetching;
    this.fetching = undefined;
    return this.next();
  }

  async return(): Promise<IteratorResult<T>> {
    this.stop();
    return { done: true, value: undefined };
  }

  async throw(error?: unknown): Promise<IteratorResult<T>> {
    this.stop(error);
    throw error;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> { return this; }

  stop(reason?: unknown): void {
    if (this.done) return;
    this.done = true;
    this.failure = reason;
    this.controller.abort(reason);
  }

  private async fill(): Promise<void> {
    while (!this.done && this.items.length === 0) {
      try {
        const page = await this.fetchPage(this.cursorValue, this.controller.signal);
        if (!Array.isArray(page.items)) throw new TypeError("Cursor feed pages require an items array");
        this.items.push(...page.items);
        const pageCursor = page.nextCursor;
        const itemCursor = this.items.length > 0 && this.cursorOf ? this.cursorOf(this.items[this.items.length - 1] as T) : undefined;
        if (pageCursor !== undefined) this.cursorValue = pageCursor;
        else if (itemCursor !== undefined) this.cursorValue = itemCursor;
        if (page.done === true) this.done = true;
        if (this.items.length === 0 && !this.done) await delay(this.pollIntervalMs, this.controller.signal);
      } catch (error) {
        if (this.done && this.failure !== undefined) return;
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

export function cursorFeed<T, C extends Cursor = number>(options: CursorFeedOptions<T, C>): CursorFeed<T, C> {
  return new CursorFeed(options);
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds === 0) {
    signal.throwIfAborted();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
