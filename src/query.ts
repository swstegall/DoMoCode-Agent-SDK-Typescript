import { DoMoCodeClient } from "./client.ts";
import { InteractionRuntime, type InteractionPolicy, type PermissionAsk, type QuestionAsk } from "./interactionRuntime.ts";
import type { SessionHandle, PromptOptions, SendOptions, SettleResult } from "./session.ts";
import type { ImageBlock, Message } from "./types/messages.ts";
import type { CommandRegistry, ToolCatalogEntry } from "./types/catalogs.ts";
import type { ServerCapabilities, SessionAccounting } from "./types/sessions.ts";
import type { ServerEvent } from "./types/events.ts";
import { messageText } from "./types/messages.ts";
import { renderTranscript, type TranscriptOptions } from "./transcript.ts";
import type { FetchFunction } from "./transport.ts";

export interface QueryServerRef { baseURL: string; token: string; fetch?: FetchFunction }

export interface QueryOptions {
  prompt?: string;
  server?: DoMoCodeClient | QueryServerRef;
  baseURL?: string;
  token?: string;
  fetch?: FetchFunction;
  clientId?: string;
  owner?: string;
  session?: { resume?: string; fork?: boolean };
  model?: string;
  mode?: string;
  agent?: string;
  images?: ImageBlock[];
  permissionPolicy?: InteractionPolicy;
  onPermission?: (ask: PermissionAsk) => Promise<void> | void;
  onQuestion?: (ask: QuestionAsk) => Promise<void> | void;
  allowPersistentGrants?: boolean;
  signal?: AbortSignal;
  maxIdleMs?: number;
  keepSession?: boolean;
  warn?: (message: string) => void;
}

export interface QueryInputOptions extends Omit<QueryOptions, "prompt"> {}

export interface QueryInitEvent {
  type: "init";
  sessionId: string;
  model?: string;
  mode?: string;
  agent?: string;
  tools: ToolCatalogEntry[];
  commands: CommandRegistry;
  capabilities: ServerCapabilities | undefined;
}

export type QueryEvent = QueryInitEvent | ServerEvent;

export interface QueryResult {
  stopReason: string;
  messages: Message[];
  accounting?: SessionAccounting;
  notices: Array<{ level: string; code: string; text: string; detail?: string }>;
  session?: SessionHandle;
}

interface QueueWaiter<T> { resolve: (result: IteratorResult<T>) => void; reject: (reason: unknown) => void }

class QueryQueue<T> implements AsyncIterableIterator<T> {
  private readonly values: T[] = [];
  private readonly waiters: QueueWaiter<T>[] = [];
  private ended = false;
  private failure: unknown;

  constructor(private readonly maxSize = 1_024) {}

  push(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else {
      if (this.values.length >= this.maxSize) this.values.shift();
      this.values.push(value);
    }
  }

  end(error?: unknown): void {
    if (this.ended) return;
    this.ended = true;
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
    if (this.ended) return this.failure ? Promise.reject(this.failure) : Promise.resolve({ value: undefined as never, done: true });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async return(): Promise<IteratorResult<T>> { this.end(); return { value: undefined as never, done: true }; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T> { return this; }
}

export interface QueryStream extends AsyncIterableIterator<QueryEvent> {
  readonly result: Promise<QueryResult>;
  readonly session: Promise<SessionHandle>;
  send(text: string, options?: SendOptions): Promise<void>;
  steer(text: string, options?: PromptOptions): Promise<void>;
  interrupt(): Promise<boolean>;
  abort(): Promise<boolean>;
  finalText(): Promise<string>;
  transcript(options?: TranscriptOptions): Promise<string>;
  usage(): Promise<SessionAccounting | undefined>;
}

class QueryStreamImpl implements QueryStream {
  readonly result: Promise<QueryResult>;
  readonly session: Promise<SessionHandle>;
  private readonly queue = new QueryQueue<QueryEvent>();
  private readonly ready = deferred<SessionHandle>();
  private readonly source: AsyncIterable<string> | undefined;
  private readonly options: QueryOptions;
  private readonly client: DoMoCodeClient;
  private readonly ownsClient: boolean;
  private sessionHandle: SessionHandle | undefined;
  private eventsStopped = false;
  private iterationStopped = false;
  private interrupted = false;
  private readonly terminalEvent = deferred<void>();

  constructor(source: AsyncIterable<string> | undefined, options: QueryOptions) {
    this.source = source;
    this.options = options;
    const resolved = resolveClient(options);
    this.client = resolved.client;
    this.ownsClient = resolved.ownsClient;
    this.session = this.ready.promise;
    this.result = this.execute();
  }

  async next(): Promise<IteratorResult<QueryEvent>> { return this.queue.next(); }

  async return(): Promise<IteratorResult<QueryEvent>> {
    await this.stopIteration(true);
    return { value: undefined as never, done: true };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<QueryEvent> { return this; }

  async send(text: string, options: SendOptions = {}): Promise<void> {
    const session = await this.ready.promise;
    await session.send(text, options);
  }

  async steer(text: string, options: PromptOptions = {}): Promise<void> {
    const session = await this.ready.promise;
    await session.steer(text, options);
  }

  async interrupt(): Promise<boolean> {
    const session = await this.ready.promise;
    this.interrupted = true;
    return session.abort();
  }

  async abort(): Promise<boolean> { return this.interrupt(); }

  async finalText(): Promise<string> {
    const result = await this.result;
    return result.messages.filter((message) => message.role === "assistant").map(messageText).at(-1) ?? "";
  }

  async transcript(options: TranscriptOptions = {}): Promise<string> {
    return renderTranscript((await this.result).messages, options);
  }

  async usage(): Promise<SessionAccounting | undefined> { return (await this.result).accounting; }

  private async execute(): Promise<QueryResult> {
    let session: SessionHandle | undefined;
    let eventReader: Promise<void> | undefined;
    let unsubscribeHandlers: Array<() => void> = [];
    let removeSignal: (() => void) | undefined;
    try {
      session = await this.openSession();
      this.sessionHandle = session;
      this.ready.resolve(session);
      await this.configureSession(session);
      unsubscribeHandlers = await this.installInteractions(session);
      removeSignal = this.installSignal(session);
      const [capabilities, commands, tools] = await Promise.all([
        this.client.capabilities(),
        this.client.catalogs.commands(),
        session.tools()
      ]);
      const status = await session.status();
      const init: QueryInitEvent = {
        type: "init",
        sessionId: session.id,
        ...(this.options.model === undefined ? {} : { model: this.options.model }),
        ...(this.options.mode === undefined ? {} : { mode: this.options.mode }),
        ...(this.options.agent === undefined ? {} : { agent: this.options.agent }),
        tools,
        commands,
        capabilities: capabilities,
      };
      if (init.mode === undefined && status.mode !== undefined) init.mode = status.mode;
      if (init.agent === undefined && status.agent !== undefined) init.agent = status.agent;
      this.queue.push(init);

      eventReader = this.readEvents(session);
      await session.eventsEngine?.waitForConnected();
      const settled = await this.drivePrompts(session);
      await Promise.race([this.terminalEvent.promise, delay(250)]);
      this.eventsStopped = true;
      await session.eventsEngine?.stop().catch(() => undefined);
      await eventReader;
      const messages = await session.messages();
      const notices = this.notices;
      const result: QueryResult = {
        stopReason: this.interrupted ? "aborted" : settled.stopReason === "idle" ? "completed" : settled.stopReason,
        messages,
        ...(settled.status.accounting === undefined ? {} : { accounting: settled.status.accounting }),
        notices,
        ...(this.options.keepSession ? { session } : {})
      };
      return result;
    } catch (error) {
      this.ready.reject(error);
      this.queue.end(error);
      throw error;
    } finally {
      this.eventsStopped = true;
      removeSignal?.();
      unsubscribeHandlers.forEach((unsubscribe) => unsubscribe());
      if (session) await session.eventsEngine?.stop().catch(() => undefined);
      if (eventReader) await eventReader.catch(() => undefined);
      if (session && !this.options.keepSession) await session.dispose().catch(() => undefined);
      if (this.ownsClient && !this.options.keepSession) await this.client.close().catch(() => undefined);
      if (!this.queueEnded) this.queue.end();
    }
  }

  private readonly notices: QueryResult["notices"] = [];
  private queueEnded = false;

  private async openSession(): Promise<SessionHandle> {
    if (this.options.session?.resume) {
      const resumed = await this.client.sessions.resume(this.options.session.resume);
      if (this.options.session.fork) {
        const fork = await resumed.fork();
        await resumed.dispose();
        return fork;
      }
      return resumed;
    }
    return this.client.sessions.create();
  }

  private async configureSession(session: SessionHandle): Promise<void> {
    if (this.options.model !== undefined) await session.setModel(this.options.model);
    if (this.options.mode !== undefined) await session.setMode(this.options.mode);
  }

  private async installInteractions(session: SessionHandle): Promise<Array<() => void>> {
    const runtime = session.interactionRuntimeFor({
      ...(this.options.allowPersistentGrants === undefined ? {} : { allowPersistentGrants: this.options.allowPersistentGrants }),
      ...(this.options.permissionPolicy === undefined ? {} : { policy: this.options.permissionPolicy }),
      ...(this.options.warn === undefined ? {} : { warn: this.options.warn })
    });
    const unsubs: Array<() => void> = [];
    if (this.options.onPermission) unsubs.push(runtime.onInteraction((ask) => ask.kind === "permission" && "allow" in ask ? this.options.onPermission!(ask as PermissionAsk) : "decline"));
    if (this.options.onQuestion) unsubs.push(runtime.onInteraction((ask) => ask.kind === "question" && "answer" in ask ? this.options.onQuestion!(ask as QuestionAsk) : "decline"));
    await runtime.attach(session);
    return unsubs;
  }

  private installSignal(session: SessionHandle): (() => void) | undefined {
    const signal = this.options.signal;
    if (!signal) return undefined;
    const abort = () => { this.interrupted = true; void session.abort().catch(() => undefined); };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    return () => signal.removeEventListener("abort", abort);
  }

  private async drivePrompts(session: SessionHandle): Promise<SettleResult> {
    const maxIdleMs = finiteIdle(this.options.maxIdleMs);
    if (this.source) {
      let sent = false;
      for await (const prompt of this.source) {
        if (this.options.signal?.aborted) throw this.options.signal.reason ?? new Error("Query was aborted.");
        if (!sent) { await session.prompt(prompt, { ...(this.options.images === undefined ? {} : { images: this.options.images }) }); sent = true; }
        else await session.send(prompt);
      }
      if (!sent) return session.settled({ maxIdleMs: 0 });
      return session.settled({ maxIdleMs });
    }
    if (this.options.prompt === undefined) throw new TypeError("query() requires prompt or an async iterable of prompts");
    if (this.options.signal?.aborted) throw this.options.signal.reason ?? new Error("Query was aborted.");
    await session.prompt(this.options.prompt, { ...(this.options.images === undefined ? {} : { images: this.options.images }) });
    return session.settled({ maxIdleMs });
  }

  private async readEvents(session: SessionHandle): Promise<void> {
    try {
      for await (const event of session.events()) {
        if (event.type === "notice" && "notice" in event) this.notices.push(event.notice);
        if (this.eventsStopped) break;
        this.queue.push(event);
        if (event.type === "agent_end") this.terminalEvent.resolve();
      }
    } catch (error) {
      if (!this.eventsStopped) this.queue.end(error);
    }
  }

  private async stopIteration(releaseAuthority: boolean): Promise<void> {
    if (this.iterationStopped) return;
    this.iterationStopped = true;
    this.eventsStopped = true;
    if (releaseAuthority && this.sessionHandle) await this.sessionHandle.releaseAuthority().catch(() => undefined);
    if (this.sessionHandle?.eventsEngine) await this.sessionHandle.eventsEngine.stop().catch(() => undefined);
  }
}

export function query(options: QueryOptions): QueryStream;
export function query(prompts: AsyncIterable<string>, options?: QueryInputOptions): QueryStream;
export function query(input: QueryOptions | AsyncIterable<string>, options: QueryInputOptions = {}): QueryStream {
  const source = isAsyncIterable(input) ? input : undefined;
  const queryOptions: QueryOptions = source ? { ...options } : input as QueryOptions;
  return new QueryStreamImpl(source, queryOptions);
}

export function runQuery(options: QueryOptions): Promise<QueryResult>;
export function runQuery(prompts: AsyncIterable<string>, options?: QueryInputOptions): Promise<QueryResult>;
export async function runQuery(input: QueryOptions | AsyncIterable<string>, options?: QueryInputOptions): Promise<QueryResult> {
  return (isAsyncIterable(input) ? query(input, options) : query(input)).result;
}

function resolveClient(options: QueryOptions): { client: DoMoCodeClient; ownsClient: boolean } {
  if (options.server && isClient(options.server)) return { client: options.server, ownsClient: false };
  const server = options.server && !isClient(options.server) ? options.server : undefined;
  const baseURL = server?.baseURL ?? options.baseURL;
  const token = server?.token ?? options.token;
  if (!baseURL || !token) throw new TypeError("query() requires server or baseURL and token");
  const fetch = server?.fetch ?? options.fetch;
  const client = new DoMoCodeClient({ baseURL, token, ...(fetch === undefined ? {} : { fetch }), ...(options.clientId === undefined ? {} : { clientId: options.clientId }), ...(options.owner === undefined ? {} : { owner: options.owner }) });
  return { client, ownsClient: true };
}

function isClient(value: unknown): value is DoMoCodeClient { return value instanceof DoMoCodeClient; }
function isAsyncIterable(value: unknown): value is AsyncIterable<string> { return typeof value === "object" && value !== null && Symbol.asyncIterator in value; }
function finiteIdle(value: number | undefined): number { return value === undefined ? 5_000 : Number.isFinite(value) && value >= 0 ? value : 5_000; }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => { resolve = promiseResolve; reject = promiseReject; });
  return { promise, resolve, reject };
}
