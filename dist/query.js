import { DoMoCodeClient } from "./client.js";
import { InteractionRuntime } from "./interactionRuntime.js";
import { messageText } from "./types/messages.js";
import { renderTranscript } from "./transcript.js";
class QueryQueue {
    maxSize;
    values = [];
    waiters = [];
    ended = false;
    failure;
    constructor(maxSize = 1_024) {
        this.maxSize = maxSize;
    }
    push(value) {
        if (this.ended)
            return;
        const waiter = this.waiters.shift();
        if (waiter)
            waiter.resolve({ value, done: false });
        else {
            if (this.values.length >= this.maxSize)
                this.values.shift();
            this.values.push(value);
        }
    }
    end(error) {
        if (this.ended)
            return;
        this.ended = true;
        this.failure = error;
        while (this.waiters.length > 0) {
            const waiter = this.waiters.shift();
            if (!waiter)
                continue;
            if (error)
                waiter.reject(error);
            else
                waiter.resolve({ value: undefined, done: true });
        }
    }
    next() {
        const value = this.values.shift();
        if (value !== undefined)
            return Promise.resolve({ value, done: false });
        if (this.ended)
            return this.failure ? Promise.reject(this.failure) : Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    }
    async return() { this.end(); return { value: undefined, done: true }; }
    [Symbol.asyncIterator]() { return this; }
}
class QueryStreamImpl {
    result;
    session;
    queue = new QueryQueue();
    ready = deferred();
    source;
    options;
    client;
    ownsClient;
    sessionHandle;
    eventsStopped = false;
    iterationStopped = false;
    interrupted = false;
    terminalEvent = deferred();
    constructor(source, options) {
        this.source = source;
        this.options = options;
        const resolved = resolveClient(options);
        this.client = resolved.client;
        this.ownsClient = resolved.ownsClient;
        this.session = this.ready.promise;
        this.result = this.execute();
    }
    async next() { return this.queue.next(); }
    async return() {
        await this.stopIteration(true);
        return { value: undefined, done: true };
    }
    [Symbol.asyncIterator]() { return this; }
    async send(text, options = {}) {
        const session = await this.ready.promise;
        await session.send(text, options);
    }
    async steer(text, options = {}) {
        const session = await this.ready.promise;
        await session.steer(text, options);
    }
    async interrupt() {
        const session = await this.ready.promise;
        this.interrupted = true;
        return session.abort();
    }
    async abort() { return this.interrupt(); }
    async finalText() {
        const result = await this.result;
        return result.messages.filter((message) => message.role === "assistant").map(messageText).at(-1) ?? "";
    }
    async transcript(options = {}) {
        return renderTranscript((await this.result).messages, options);
    }
    async usage() { return (await this.result).accounting; }
    async execute() {
        let session;
        let eventReader;
        let unsubscribeHandlers = [];
        let removeSignal;
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
            const init = {
                type: "init",
                sessionId: session.id,
                ...(this.options.model === undefined ? {} : { model: this.options.model }),
                ...(this.options.mode === undefined ? {} : { mode: this.options.mode }),
                ...(this.options.agent === undefined ? {} : { agent: this.options.agent }),
                tools,
                commands,
                capabilities: capabilities,
            };
            if (init.mode === undefined && status.mode !== undefined)
                init.mode = status.mode;
            if (init.agent === undefined && status.agent !== undefined)
                init.agent = status.agent;
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
            const result = {
                stopReason: this.interrupted ? "aborted" : settled.stopReason === "idle" ? "completed" : settled.stopReason,
                messages,
                ...(settled.status.accounting === undefined ? {} : { accounting: settled.status.accounting }),
                notices,
                ...(this.options.keepSession ? { session } : {})
            };
            return result;
        }
        catch (error) {
            this.ready.reject(error);
            this.queue.end(error);
            throw error;
        }
        finally {
            this.eventsStopped = true;
            removeSignal?.();
            unsubscribeHandlers.forEach((unsubscribe) => unsubscribe());
            if (session)
                await session.eventsEngine?.stop().catch(() => undefined);
            if (eventReader)
                await eventReader.catch(() => undefined);
            if (session && !this.options.keepSession)
                await session.dispose().catch(() => undefined);
            if (this.ownsClient && !this.options.keepSession)
                await this.client.close().catch(() => undefined);
            if (!this.queueEnded)
                this.queue.end();
        }
    }
    notices = [];
    queueEnded = false;
    async openSession() {
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
    async configureSession(session) {
        if (this.options.model !== undefined)
            await session.setModel(this.options.model);
        if (this.options.mode !== undefined)
            await session.setMode(this.options.mode);
    }
    async installInteractions(session) {
        const runtime = session.interactionRuntimeFor({
            ...(this.options.allowPersistentGrants === undefined ? {} : { allowPersistentGrants: this.options.allowPersistentGrants }),
            ...(this.options.permissionPolicy === undefined ? {} : { policy: this.options.permissionPolicy }),
            ...(this.options.warn === undefined ? {} : { warn: this.options.warn })
        });
        const unsubs = [];
        if (this.options.onPermission)
            unsubs.push(runtime.onInteraction((ask) => ask.kind === "permission" && "allow" in ask ? this.options.onPermission(ask) : "decline"));
        if (this.options.onQuestion)
            unsubs.push(runtime.onInteraction((ask) => ask.kind === "question" && "answer" in ask ? this.options.onQuestion(ask) : "decline"));
        await runtime.attach(session);
        return unsubs;
    }
    installSignal(session) {
        const signal = this.options.signal;
        if (!signal)
            return undefined;
        const abort = () => { this.interrupted = true; void session.abort().catch(() => undefined); };
        if (signal.aborted)
            abort();
        else
            signal.addEventListener("abort", abort, { once: true });
        return () => signal.removeEventListener("abort", abort);
    }
    async drivePrompts(session) {
        const maxIdleMs = finiteIdle(this.options.maxIdleMs);
        if (this.source) {
            let sent = false;
            for await (const prompt of this.source) {
                if (this.options.signal?.aborted)
                    throw this.options.signal.reason ?? new Error("Query was aborted.");
                if (!sent) {
                    await session.prompt(prompt, { ...(this.options.images === undefined ? {} : { images: this.options.images }) });
                    sent = true;
                }
                else
                    await session.send(prompt);
            }
            if (!sent)
                return session.settled({ maxIdleMs: 0 });
            return session.settled({ maxIdleMs });
        }
        if (this.options.prompt === undefined)
            throw new TypeError("query() requires prompt or an async iterable of prompts");
        if (this.options.signal?.aborted)
            throw this.options.signal.reason ?? new Error("Query was aborted.");
        await session.prompt(this.options.prompt, { ...(this.options.images === undefined ? {} : { images: this.options.images }) });
        return session.settled({ maxIdleMs });
    }
    async readEvents(session) {
        try {
            for await (const event of session.events()) {
                if (event.type === "notice" && "notice" in event)
                    this.notices.push(event.notice);
                if (this.eventsStopped)
                    break;
                this.queue.push(event);
                if (event.type === "agent_end")
                    this.terminalEvent.resolve();
            }
        }
        catch (error) {
            if (!this.eventsStopped)
                this.queue.end(error);
        }
    }
    async stopIteration(releaseAuthority) {
        if (this.iterationStopped)
            return;
        this.iterationStopped = true;
        this.eventsStopped = true;
        if (releaseAuthority && this.sessionHandle)
            await this.sessionHandle.releaseAuthority().catch(() => undefined);
        if (this.sessionHandle?.eventsEngine)
            await this.sessionHandle.eventsEngine.stop().catch(() => undefined);
    }
}
export function query(input, options = {}) {
    const source = isAsyncIterable(input) ? input : undefined;
    const queryOptions = source ? { ...options } : input;
    return new QueryStreamImpl(source, queryOptions);
}
export async function runQuery(input, options) {
    return (isAsyncIterable(input) ? query(input, options) : query(input)).result;
}
function resolveClient(options) {
    if (options.server && isClient(options.server))
        return { client: options.server, ownsClient: false };
    const server = options.server && !isClient(options.server) ? options.server : undefined;
    const baseURL = server?.baseURL ?? options.baseURL;
    const token = server?.token ?? options.token;
    if (!baseURL || !token)
        throw new TypeError("query() requires server or baseURL and token");
    const fetch = server?.fetch ?? options.fetch;
    const client = new DoMoCodeClient({ baseURL, token, ...(fetch === undefined ? {} : { fetch }), ...(options.clientId === undefined ? {} : { clientId: options.clientId }), ...(options.owner === undefined ? {} : { owner: options.owner }) });
    return { client, ownsClient: true };
}
function isClient(value) { return value instanceof DoMoCodeClient; }
function isAsyncIterable(value) { return typeof value === "object" && value !== null && Symbol.asyncIterator in value; }
function finiteIdle(value) { return value === undefined ? 5_000 : Number.isFinite(value) && value >= 0 ? value : 5_000; }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => { resolve = promiseResolve; reject = promiseReject; });
    return { promise, resolve, reject };
}
//# sourceMappingURL=query.js.map