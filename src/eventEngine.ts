import { decodeServerEvent, type ServerEvent } from "./types/events.ts";
import { SseDecodeError, readSSEJson } from "./sse.ts";

export class ProtocolMismatchError extends Error {
  constructor(public readonly received: number, public readonly expected: number) { super(`Unsupported DoMoCode protocol version ${received}; expected ${expected}`); this.name = "ProtocolMismatchError"; }
}

export class EventStreamError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = "EventStreamError"; }
}

export class EventStreamWatchdogError extends EventStreamError {
  constructor() { super("DoMoCode SSE stream was silent past the heartbeat watchdog."); this.name = "EventStreamWatchdogError"; }
}

export interface EventEngineStats { reconnects: number; lastSequence: number; lagged: number; connected: number; heartbeats: number }
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

interface QueueWaiter<T> { resolve: (result: IteratorResult<T>) => void; reject: (reason: unknown) => void }

class AsyncQueue<T> implements AsyncIterableIterator<T> {
  private readonly values: T[] = [];
  private readonly waiters: QueueWaiter<T>[] = [];
  private finished = false;
  private failure: unknown;
  constructor(private readonly size: number, private readonly onLagged: () => void) {}

  push(value: T): void {
    if (this.finished) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else {
      if (this.values.length >= this.size) { this.values.shift(); this.onLagged(); }
      this.values.push(value);
    }
  }

  end(error?: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.failure = error;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter) continue;
      if (error) waiter.reject(error);
      else waiter.resolve({ value: undefined as never, done: true });
    }
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ value, done: false });
    if (this.finished) return this.failure ? Promise.reject(this.failure) : Promise.resolve({ value: undefined as never, done: true });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async return(): Promise<IteratorResult<T>> { this.end(); return { value: undefined as never, done: true }; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T> { return this; }
}

/** A reconnecting, sequence-aware consumer for one DoMoCode SSE stream. */
export class EventEngine implements AsyncIterableIterator<ServerEvent> {
  readonly stats: EventEngineStats = { reconnects: 0, lastSequence: 0, lagged: 0, connected: 0, heartbeats: 0 };
  private readonly options: EventEngineOptions & Required<Pick<EventEngineOptions, "protocolVersion" | "heartbeatTimeoutMs" | "initialBackoffMs" | "maximumBackoffMs" | "queueSize">>;
  private readonly queue: AsyncQueue<ServerEvent>;
  private readonly reconciledInteractions = new Set<string>();
  private readonly stopped = new AbortController();
  private started = false;
  private runPromise: Promise<void> | undefined;

  constructor(options: EventEngineOptions) {
    this.options = {
      ...options,
      protocolVersion: options.protocolVersion ?? 1,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 40_000,
      initialBackoffMs: options.initialBackoffMs ?? 125,
      maximumBackoffMs: options.maximumBackoffMs ?? 4_000,
      queueSize: options.queueSize ?? 512
    };
    this.queue = new AsyncQueue(this.options.queueSize, () => { this.stats.lagged += 1; options.onLagged?.(this.stats.lagged); });
  }

  get lastSequence(): number { return this.stats.lastSequence; }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.runPromise = this.run();
  }

  async stop(): Promise<void> {
    this.stopped.abort();
    this.queue.end();
    await this.runPromise;
  }

  async next(): Promise<IteratorResult<ServerEvent>> { this.start(); return this.queue.next(); }
  async return(): Promise<IteratorResult<ServerEvent>> { await this.stop(); return { value: undefined as never, done: true }; }
  [Symbol.asyncIterator](): AsyncIterableIterator<ServerEvent> { return this; }

  private async run(): Promise<void> {
    let backoff = this.options.initialBackoffMs;
    while (!this.stopped.signal.aborted) {
      const streamAbort = new AbortController();
      const stop = () => streamAbort.abort();
      this.stopped.signal.addEventListener("abort", stop, { once: true });
      try {
        const response = await this.options.open(this.stats.lastSequence, streamAbort.signal);
        if (response.status === 404) {
          await this.options.revive?.(streamAbort.signal);
          this.stats.reconnects += 1;
          backoff = this.options.initialBackoffMs;
          continue;
        }
        if (response.status < 200 || response.status >= 300) throw new EventStreamError(`DoMoCode SSE returned HTTP ${response.status}.`, response.status);
        this.stats.connected += 1;
        await this.consume(response, streamAbort);
        backoff = this.options.initialBackoffMs;
      } catch (error) {
        if (this.stopped.signal.aborted) break;
        if (error instanceof ProtocolMismatchError || error instanceof SseDecodeError) { this.queue.end(error); break; }
        this.stats.reconnects += 1;
        await abortableDelay(backoff, this.stopped.signal);
        backoff = Math.min(this.options.maximumBackoffMs, backoff * 2);
      } finally {
        this.stopped.signal.removeEventListener("abort", stop);
        streamAbort.abort();
      }
    }
  }

  private async consume(response: Response, streamAbort: AbortController): Promise<void> {
    const frames = readSSEJson(response, streamAbort.signal);
    const iterator = frames[Symbol.asyncIterator]();
    while (!this.stopped.signal.aborted) {
      let result: IteratorResult<unknown>;
      try { result = await withTimeout(iterator.next(), this.options.heartbeatTimeoutMs, streamAbort); }
      catch (error) {
        if (error instanceof EventStreamWatchdogError) throw error;
        throw error;
      }
      if (result.done) return;
      const raw = result.value;
      const event = decodeServerEvent(raw);
      if (event.type === "heartbeat") { this.stats.heartbeats += 1; continue; }
      if (event.type === "connected") {
        if (!("protocolVersion" in event) || event.protocolVersion !== this.options.protocolVersion) throw new ProtocolMismatchError("protocolVersion" in event && typeof event.protocolVersion === "number" ? event.protocolVersion : -1, this.options.protocolVersion);
        this.queue.push(event);
        if (this.options.reconcile) {
          for (const pending of await this.options.reconcile(streamAbort.signal)) {
            const event = decodeServerEvent(pending);
            const key = interactionKey(event);
            if (key) this.reconciledInteractions.add(key);
            this.queue.push(event);
          }
        }
        continue;
      }
      const sequence = sequenceOf(raw);
      if (sequence !== undefined) {
        if (sequence <= this.stats.lastSequence) continue;
        this.stats.lastSequence = sequence;
      }
      const key = interactionKey(event);
      if (key && this.reconciledInteractions.has(key)) {
        this.reconciledInteractions.delete(key);
        continue;
      }
      if ((event.type === "permission_resolved" || event.type === "question_resolved") && "id" in event) this.reconciledInteractions.delete(`${event.type === "permission_resolved" ? "permission" : "question"}:${event.id}`);
      this.queue.push(event);
    }
    await iterator.return?.(undefined);
  }
}

function interactionKey(event: ServerEvent): string | undefined {
  if (event.type === "permission_request" && "id" in event) return `permission:${event.id}`;
  if (event.type === "question_request" && "id" in event) return `question:${event.id}`;
  return undefined;
}

function sequenceOf(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || !("sequence" in value)) return undefined;
  const sequence = (value as { sequence?: unknown }).sequence;
  return typeof sequence === "number" && Number.isSafeInteger(sequence) ? sequence : undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new EventStreamWatchdogError()); }, timeoutMs); })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
