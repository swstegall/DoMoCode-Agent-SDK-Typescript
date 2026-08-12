import { EventEngine } from "./eventEngine.js";
import { Transport, encodePathSegment } from "./transport.js";
import { decodeMessage } from "./types/messages.js";
import { decodeServerEvent } from "./types/events.js";
import { validateClientToolDefinitions } from "./types/tools.js";
import { isRecord, requiredArray, requiredBoolean, requiredNumber, requiredString } from "./types/common.js";
import { asDecimalString } from "./types/decimal.js";
import { AttachRejectedError, AuthorityUnavailableError, ConflictError, DoMoError, NotFoundError, RunStalledError, RunStateRaceError, SessionAlreadyAcquiredError, SessionBusyError } from "./types/errors.js";
import { InteractionRuntime } from "./interactionRuntime.js";
import { decodeToolCatalog, filterToolCatalog } from "./catalogs.js";
import { renderTranscript } from "./transcript.js";
import { SubagentRegistry } from "./subagents.js";
export class SessionHandle {
    client;
    ref;
    forget;
    attachment;
    engine;
    disposed = false;
    runLock = false;
    leaseRelease;
    leaseMode;
    cursor = 0;
    interactionRuntime;
    subagentRegistry;
    clientToolSubscription;
    activeClientTools = new Map();
    constructor(client, ref, forget) { this.client = client; this.ref = ref; this.forget = forget; }
    get id() { return this.ref.id; }
    get path() { return this.ref.path; }
    get role() { return this.attachment?.role; }
    get clientAttachment() { return this.attachment; }
    get eventsEngine() { return this.engine; }
    setLease(mode, release) {
        if (this.leaseRelease && mode === "exclusive")
            throw new SessionAlreadyAcquiredError(this.id);
        this.leaseMode = mode;
        this.leaseRelease = release;
    }
    async release() { this.leaseRelease?.(); this.leaseRelease = undefined; this.leaseMode = undefined; }
    async attach(options = {}) {
        this.assertUsable();
        const authority = options.authority ?? "require";
        const clientTools = options.clientTools === undefined ? undefined : validateClientToolDefinitions(options.clientTools);
        try {
            const resumed = await this.client.transport.json("/session", { method: "POST", body: { resume: this.id, ...(clientTools === undefined ? {} : { clientTools }) } });
            this.ref = decodeRef(resumed, this.ref);
        }
        catch (error) {
            if (!(error instanceof NotFoundError))
                throw error;
            await this.status();
        }
        const path = `/session/${encodePathSegment(this.id)}/client/attach`;
        let attachment;
        try {
            const value = await this.client.transport.json(path, { method: "POST", body: { clientID: this.client.clientId, owner: this.client.owner, requestAuthority: authority !== "observer" } });
            attachment = decodeAttachment(value, this.id);
        }
        catch (error) {
            if (!(error instanceof NotFoundError))
                throw error;
            // A 404 is only treated as a pre-ledger server after liveness was checked.
            await this.status();
            if (authority === "require")
                throw new AuthorityUnavailableError(this.id);
            attachment = { clientId: this.client.clientId, sessionId: this.id, owner: this.client.owner, role: "observer", active: true, eventCursor: this.cursor };
        }
        if (authority === "require" && attachment.role !== "authority") {
            const holder = await this.authority().catch(() => undefined);
            throw new AuthorityUnavailableError(this.id, holder);
        }
        this.attachment = attachment;
        this.cursor = Math.max(this.cursor, attachment.eventCursor ?? 0);
        if (!this.engine) {
            this.engine = new EventEngine({
                open: (after, signal) => this.client.transport.request(`${sessionPath(this.id, `/events?after=${after}`)}`, { signal, stream: true }),
                revive: async (signal) => { await this.client.transport.json("/session", { method: "POST", body: { resume: this.id }, signal }); },
                reconcile: (signal) => this.reconcile(signal)
            });
            this.engine.onEvent((event) => {
                if (event.type === "mcp_changed" && "server" in event)
                    this.client.mcp.invalidate(event.server);
                if (event.type === "client_tool_resolved" && "id" in event && typeof event.id === "string")
                    this.resolveClientTool(event.id);
            });
            this.engine.start();
        }
        return attachment;
    }
    events() { this.assertUsable(); if (!this.engine)
        throw new Error("Session is not attached"); return this.engine; }
    onEvent(listener) { return this.events().onEvent(listener); }
    /**
     * Execute model calls for tools registered by the client and post their
     * results back to the owning session. Only one handler is active per handle;
     * registering a new one cleanly replaces the previous handler.
     */
    onToolCall(handler, options = {}) {
        this.assertUsable();
        const timeoutMs = options.timeoutMs ?? 60_000;
        if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
            throw new TypeError("Client tool timeoutMs must be a finite non-negative number");
        this.clientToolSubscription?.();
        const unsubscribe = this.events().onEvent((event) => {
            if (event.type === "client_tool_resolved" && "id" in event && typeof event.id === "string") {
                this.resolveClientTool(event.id);
                return;
            }
            if (event.type === "client_tool_request" && "sessionId" in event && event.sessionId === this.id)
                void this.executeClientTool(event, handler, timeoutMs);
        });
        this.clientToolSubscription = () => {
            unsubscribe();
            for (const active of this.activeClientTools.values())
                active.controller.abort(new Error("Client tool handler was removed."));
            this.clientToolSubscription = undefined;
        };
        return this.clientToolSubscription;
    }
    /** Return the session's single interaction dispatcher, creating it lazily. */
    interactionRuntimeFor(options = {}) {
        this.assertUsable();
        if (!this.interactionRuntime) {
            this.interactionRuntime = new InteractionRuntime(options);
            void this.interactionRuntime.attach(this).catch((error) => {
                options.warn?.(`DoMoCode interaction reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
        return this.interactionRuntime;
    }
    interactions(options = {}) {
        return this.interactionRuntimeFor(options).interactions();
    }
    onInteraction(handler, options = {}) {
        return this.interactionRuntimeFor(options).onInteraction(handler);
    }
    /** Return the live subagent index; child streams are observed by default. */
    subagents(options = {}) {
        this.assertUsable();
        if (!this.subagentRegistry)
            this.subagentRegistry = new SubagentRegistry(this, options);
        return this.subagentRegistry;
    }
    async prompt(text, options = {}) { await this.postPrompt("prompt", text, options); }
    async steer(text, options = {}) { await this.postPrompt("steer", text, options); }
    /** Invoke a server-owned prompt command through the normal prompt channel. */
    async invokePromptCommand(name, argumentsValue = {}) {
        const normalized = name.replace(/^\//, "");
        if (!/^[A-Za-z0-9_.:-]+$/.test(normalized))
            throw new TypeError("Prompt command name contains unsupported characters");
        await this.prompt(`/${normalized} ${JSON.stringify(argumentsValue)}`);
    }
    async send(text, options = {}) {
        const running = (await this.status()).running;
        const preferSteer = options.preferSteer ?? running;
        const first = preferSteer ? "steer" : "prompt";
        const second = preferSteer ? "prompt" : "steer";
        try {
            await this.postPrompt(first, text, options);
        }
        catch (error) {
            if (!(error instanceof ConflictError) || !error.route.endsWith(`/${first}`))
                throw error;
            try {
                await this.postPrompt(second, text, options);
            }
            catch (retryError) {
                if (retryError instanceof ConflictError && retryError.route.endsWith(`/${second}`))
                    throw new RunStateRaceError(retryError.route);
                throw retryError;
            }
        }
    }
    async abort() {
        const value = await this.client.transport.json(sessionPath(this.id, "/abort"), { method: "POST" });
        return !isRecord(value) || typeof value.aborted !== "boolean" ? true : value.aborted;
    }
    async forceClear() {
        const value = await this.client.transport.json(sessionPath(this.id, "/force-clear"), { method: "POST" });
        return !isRecord(value) || typeof value.cleared !== "boolean" ? true : value.cleared;
    }
    async status() {
        const value = await this.client.transport.json(sessionPath(this.id, "/status"));
        return decodeStatus(value, this.id);
    }
    async accounting() { return (await this.status()).accounting; }
    async messages() {
        const value = await this.client.transport.json(sessionPath(this.id, "/messages"));
        return requiredArray(value, "messages").map(decodeMessage);
    }
    async transcript(options = {}) {
        return renderTranscript(await this.messages(), options);
    }
    async context() {
        const value = await this.client.transport.json(sessionPath(this.id, "/context"));
        if (!isRecord(value))
            throw new TypeError("Context snapshot must be an object");
        return { messages: requiredArray(value.messages, "context.messages").map(decodeMessage), ...(value.accounting === undefined || value.accounting === null ? {} : { accounting: decodeAccounting(value.accounting) }) };
    }
    async setModel(modelId) { await this.client.transport.json(sessionPath(this.id, "/model"), { method: "POST", body: { modelID: modelId } }); }
    async setMode(mode) { await this.client.transport.json(sessionPath(this.id, "/mode"), { method: "POST", body: { mode } }); }
    async fork(options = {}) {
        const value = await this.client.transport.json(sessionPath(this.id, "/fork"), { method: "POST", expectedStatus: 201 });
        const ref = decodeRef(value, { id: "", path: "" });
        const handle = this.client.sessions.getOrCreate(ref);
        await handle.attach(options);
        return handle;
    }
    async clone(options = {}) {
        const value = await this.client.transport.json(sessionPath(this.id, "/clone"), { method: "POST", expectedStatus: 201 });
        const ref = decodeRef(value, { id: "", path: "" });
        const handle = this.client.sessions.getOrCreate(ref);
        await handle.attach(options);
        return handle;
    }
    async rename(name) { await this.client.transport.json(sessionPath(this.id, "/rename"), { method: "POST", body: { name } }); }
    async autoTitle() {
        const value = await this.client.transport.json(sessionPath(this.id, "/title"), { method: "POST" });
        return isRecord(value) && typeof value.title === "string" ? value.title : undefined;
    }
    async setLabel(targetId, label) { await this.client.transport.json(sessionPath(this.id, "/label"), { method: "POST", body: { targetID: targetId, label } }); }
    async moveLeaf(targetId) { await this.client.transport.json(sessionPath(this.id, "/leaf"), { method: "POST", body: { targetID: targetId } }); }
    async commitMessage() {
        const value = await this.client.transport.json(sessionPath(this.id, "/diff/commit-message"), { method: "POST" });
        return isRecord(value) && typeof value.message === "string" ? value.message : undefined;
    }
    async tools(filter = {}) {
        return filterToolCatalog(decodeToolCatalog(await this.client.transport.json(sessionPath(this.id, "/tools"))), filter);
    }
    /**
     * Compatibility path for MCP resources on servers before the MCP admin routes.
     * The server still owns MCP connections and returns its bounded direct-tool result.
     */
    async mcpResource(action, options = {}) {
        if (action === "read" && (!options.server || !options.uri))
            throw new TypeError("mcp_resource read requires server and uri");
        const argumentsValue = { action, ...(options.server === undefined ? {} : { server: options.server }), ...(options.uri === undefined ? {} : { uri: options.uri }) };
        return this.executeTool("mcp_resource", argumentsValue);
    }
    async executeTool(name, argumentsValue = {}) {
        if (!/^[A-Za-z0-9_.:-]+$/.test(name))
            throw new TypeError("Tool name contains unsupported direct-command characters");
        return this.executeToolCommand(`/${name} ${JSON.stringify(argumentsValue)}`);
    }
    async executeToolCommand(command) {
        const value = await this.client.transport.json(sessionPath(this.id, "/tool"), { method: "POST", body: { command } });
        return decodeDirectToolResult(value);
    }
    async task(prompt, options = {}) {
        return this.executeTool("task", {
            prompt,
            ...(options.taskId === undefined ? {} : { task_id: options.taskId }),
            ...(options.agent === undefined ? {} : { agent: options.agent }),
            ...(options.background === undefined ? {} : { background: options.background }),
            ...(options.model === undefined ? {} : { model: options.model })
        });
    }
    async resumeTask(taskId, prompt = "", options = {}) {
        return this.task(prompt, { ...options, taskId });
    }
    async answerPermission(requestId, reply, message) {
        const body = { requestID: requestId, reply, ...(message === undefined ? {} : { message }) };
        await this.client.transport.json(sessionPath(this.id, "/permission"), { method: "POST", body });
    }
    async answerQuestion(requestId, answers) {
        await this.client.transport.json(sessionPath(this.id, "/question"), { method: "POST", body: { requestID: requestId, answers } });
    }
    async pendingPermissions() {
        const value = await this.client.transport.json(sessionPath(this.id, "/permissions"));
        return requiredArray(value, "permissions").map(decodeServerEvent);
    }
    async pendingQuestions() {
        const value = await this.client.transport.json(sessionPath(this.id, "/questions"));
        return requiredArray(value, "questions").map(decodeServerEvent);
    }
    async settled(options = {}) {
        const idle = options.maxIdleMs ?? 5_000;
        const initial = await this.status();
        if (!initial.running) {
            const pending = await this.pendingInteractionPayloads(initial);
            if (pending.length > 0)
                throw new RunStalledError(pending);
            return { stopReason: "idle", status: initial };
        }
        let reason;
        const unsubscribe = this.engine?.onEvent((event) => {
            if (event.type === "agent_end" && "reason" in event)
                reason = event.reason;
        });
        const started = Date.now();
        try {
            while (Date.now() - started < idle) {
                const current = await this.status();
                if (!current.running) {
                    const pending = await this.pendingInteractionPayloads(current);
                    if (pending.length > 0)
                        throw new RunStalledError(pending);
                    return { stopReason: reason ?? "completed", status: current };
                }
                await delay(50);
            }
            const pending = await this.pendingInteractionPayloads(await this.status());
            if (pending.length > 0)
                throw new RunStalledError(pending);
            return { stopReason: reason ?? "unknown", status: await this.status() };
        }
        finally {
            unsubscribe?.();
        }
    }
    async run(prompt, options = {}) {
        if (this.runLock)
            throw new SessionBusyError({ status: 409, route: sessionPath(this.id, "/prompt") });
        this.runLock = true;
        const notices = [];
        const unsubscribe = this.engine?.onEvent((event) => { if (event.type === "notice" && "notice" in event)
            notices.push(event.notice); });
        try {
            await this.prompt(prompt, options);
            const settled = await this.settled(options);
            const stopReason = settled.stopReason === "idle" ? "completed" : settled.stopReason;
            if (stopReason === "errored")
                throw new DoMoError("DoMoCode run errored.");
            return { stopReason, messages: await this.messages(), ...(settled.status.accounting === undefined ? {} : { accounting: settled.status.accounting }), notices };
        }
        finally {
            unsubscribe?.();
            this.runLock = false;
        }
    }
    async attachAuthority() { return this.attach({ authority: "require" }); }
    async requestAuthority() { return this.attach({ authority: "require" }); }
    async releaseAuthority() {
        const path = sessionPath(this.id, "/client/authority/release");
        const value = await this.client.transport.json(path, { method: "POST", body: { clientID: this.client.clientId, owner: this.client.owner } });
        const attachment = decodeAttachment(value, this.id);
        this.attachment = attachment;
        return attachment;
    }
    async transferAuthority(toClientId) {
        const value = await this.client.transport.json(sessionPath(this.id, "/client/authority/transfer"), { method: "POST", body: { fromClientID: this.client.clientId, toClientID: toClientId, owner: this.client.owner } });
        return decodeAttachment(value, this.id);
    }
    async authority() {
        const value = await this.client.transport.json(sessionPath(this.id, "/client/authority"));
        return value === null ? undefined : decodeAttachment(value, this.id);
    }
    async clients(includeInactive = false) {
        const value = await this.client.transport.json(sessionPath(this.id, `/clients?includeInactive=${includeInactive}`));
        return requiredArray(value, "clients").map((item) => decodeAttachment(item, this.id));
    }
    async clientEvents(after = 0) { const value = await this.client.transport.json(sessionPath(this.id, `/client/events?after=${after}`)); return requiredArray(value, "client events"); }
    async clientJournal(clientId) { const query = clientId ? `?clientID=${encodeURIComponent(clientId)}` : ""; const value = await this.client.transport.json(sessionPath(this.id, `/client/export${query}`)); return requiredArray(value, "client journal"); }
    async advanceCursor(sequence = this.engine?.lastSequence ?? this.cursor) {
        const value = await this.client.transport.json(sessionPath(this.id, "/client/cursor"), { method: "POST", body: { clientID: this.client.clientId, owner: this.client.owner, sequence } });
        this.cursor = Math.max(this.cursor, sequence);
        const attachment = decodeAttachment(value, this.id);
        this.attachment = attachment;
        return attachment;
    }
    async diff(base) { const query = base ? `?base=${encodeURIComponent(base)}` : ""; return this.client.transport.json(sessionPath(this.id, `/diff${query}`)); }
    async workspaceStatus() { return this.client.transport.json(sessionPath(this.id, "/workspace-status")); }
    async undo() { return this.client.transport.json(sessionPath(this.id, "/undo"), { method: "POST" }); }
    async redo() { return this.client.transport.json(sessionPath(this.id, "/redo"), { method: "POST" }); }
    async children(parent) { const query = parent ? `?parent=${encodeURIComponent(parent)}` : ""; return this.client.transport.json(sessionPath(this.id, `/children${query}`)); }
    async tree() { return this.client.transport.json(sessionPath(this.id, "/tree")); }
    async timeline() { return this.client.transport.json(sessionPath(this.id, "/timeline")); }
    async compact() { const value = await this.client.transport.json(sessionPath(this.id, "/compact"), { method: "POST" }); return isRecord(value) && typeof value.compacted === "boolean" ? value.compacted : true; }
    async dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.clientToolSubscription?.();
        this.interactionRuntime?.close();
        await this.subagentRegistry?.close();
        try {
            if (this.engine)
                await this.engine.stop();
        }
        catch { /* disposal is best effort */ }
        try {
            if (this.engine && this.engine.lastSequence > this.cursor && this.attachment)
                await this.advanceCursor(this.engine.lastSequence);
        }
        catch { /* best effort */ }
        try {
            if (this.attachment?.role === "authority")
                await this.releaseAuthority();
        }
        catch { /* best effort */ }
        try {
            if (this.attachment)
                await this.client.transport.json(sessionPath(this.id, "/client/detach"), { method: "POST", body: { clientID: this.client.clientId, owner: this.client.owner } });
        }
        catch { /* best effort */ }
        this.leaseRelease?.();
        this.leaseRelease = undefined;
        this.forget();
    }
    async [Symbol.asyncDispose]() { await this.dispose(); }
    async postPrompt(route, text, options) {
        this.assertUsable();
        const body = options.images && options.images.length > 0 ? { prompt: text, images: options.images } : { prompt: text };
        await this.client.transport.json(sessionPath(this.id, `/${route}`), { method: "POST", body, expectedStatus: 202 });
    }
    async pendingInteractionPayloads(status) {
        const permissionIds = new Set(status.pendingPermissionIds);
        const questionIds = new Set(status.pendingQuestionIds ?? []);
        const payloads = [];
        const known = new Set();
        for (const interaction of this.interactionRuntime?.pending() ?? []) {
            const key = interaction.kind === "permission" ? `permission:${interaction.id}` : interaction.kind === "question" ? `question:${interaction.id}` : `${interaction.kind}:${interaction.id}`;
            if ((interaction.kind === "permission" && permissionIds.has(interaction.id)) || (interaction.kind === "question" && questionIds.has(interaction.id)) || (interaction.kind !== "permission" && interaction.kind !== "question")) {
                payloads.push(interaction);
                known.add(key);
            }
        }
        if (permissionIds.size === 0 && questionIds.size === 0)
            return payloads;
        const pendingEvents = await Promise.all([
            this.pendingPermissions().catch(() => []),
            this.pendingQuestions().catch(() => [])
        ]);
        for (const event of pendingEvents.flat()) {
            if (event.type === "permission_request" && "id" in event && permissionIds.has(event.id)) {
                const key = `permission:${event.id}`;
                if (!known.has(key)) {
                    payloads.push(event);
                    known.add(key);
                }
            }
            else if (event.type === "question_request" && "id" in event && questionIds.has(event.id)) {
                const key = `question:${event.id}`;
                if (!known.has(key)) {
                    payloads.push(event);
                    known.add(key);
                }
            }
        }
        for (const id of permissionIds)
            if (!known.has(`permission:${id}`))
                payloads.push({ kind: "permission", id, sessionId: this.id, raw: { id, sessionId: this.id, source: "status" } });
        for (const id of questionIds)
            if (!known.has(`question:${id}`))
                payloads.push({ kind: "question", id, sessionId: this.id, raw: { id, sessionId: this.id, source: "status" } });
        return payloads;
    }
    async reconcile(signal) {
        const events = [];
        for (const route of ["/permissions", "/questions"]) {
            try {
                events.push(...requiredArray(await this.client.transport.json(sessionPath(this.id, route), { signal }), route));
            }
            catch (error) {
                if (!(error instanceof NotFoundError))
                    throw error;
            }
        }
        return events;
    }
    resolveClientTool(requestId) {
        const active = this.activeClientTools.get(requestId);
        if (!active)
            return;
        active.settled = true;
        active.controller.abort(new Error("Client tool request was resolved by the server."));
        this.activeClientTools.delete(requestId);
    }
    async executeClientTool(event, handler, timeoutMs) {
        const previous = this.activeClientTools.get(event.id);
        previous?.controller.abort(new Error("Client tool request was superseded."));
        const controller = new AbortController();
        const active = { controller, settled: false };
        this.activeClientTools.set(event.id, active);
        let timer;
        let removeAbort;
        let result;
        try {
            const call = { id: event.id, sessionId: event.sessionId, name: event.name, arguments: event.arguments, signal: controller.signal };
            const work = Promise.resolve().then(() => handler(call));
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort(new Error(`Client tool ${event.name} timed out.`));
                    reject(new Error(`Client tool ${event.name} timed out.`));
                }, timeoutMs);
            });
            const aborted = new Promise((_, reject) => {
                const abort = () => reject(controller.signal.reason instanceof Error ? controller.signal.reason : new Error(`Client tool ${event.name} was aborted.`));
                if (controller.signal.aborted)
                    abort();
                else {
                    controller.signal.addEventListener("abort", abort, { once: true });
                    removeAbort = () => controller.signal.removeEventListener("abort", abort);
                }
            });
            const value = await Promise.race([work, timeout, aborted]);
            result = typeof value === "string" ? { output: value } : value;
            if (!result || typeof result.output !== "string")
                throw new TypeError("Client tool handlers must return a string or { output }");
        }
        catch (error) {
            result = { output: error instanceof Error ? error.message : `Client tool ${event.name} failed.`, isError: true };
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
            removeAbort?.();
        }
        if (active.settled)
            return;
        this.activeClientTools.delete(event.id);
        try {
            await this.client.transport.json(sessionPath(this.id, "/client-tool"), {
                method: "POST",
                body: {
                    requestID: event.id,
                    output: result.output,
                    isError: result.isError ?? false,
                    ...(result.images === undefined ? {} : { images: result.images })
                }
            });
        }
        catch {
            // The run may have been aborted between handler completion and posting.
            // The server-side continuation is already timeout/cancellation safe.
        }
    }
    assertUsable() { if (this.disposed)
        throw new Error("Session handle has been disposed"); }
}
function decodeRef(value, fallback) { return isRecord(value) && typeof value.id === "string" && typeof value.path === "string" ? { id: value.id, path: value.path } : fallback; }
export function decodeAttachment(value, fallbackSessionId) {
    if (!isRecord(value))
        throw new TypeError("Client attachment must be an object");
    const clientId = requiredString(value.clientID ?? value.clientId, "clientID");
    const sessionId = typeof (value.sessionID ?? value.sessionId) === "string" ? String(value.sessionID ?? value.sessionId) : fallbackSessionId;
    const role = value.role === "authority" ? "authority" : "observer";
    return { clientId, sessionId, owner: requiredString(value.owner, "owner"), role, active: value.active === undefined ? true : requiredBoolean(value.active, "active"), ...(value.attachedAt === undefined ? {} : { attachedAt: requiredString(value.attachedAt, "attachedAt") }), ...(value.updatedAt === undefined ? {} : { updatedAt: requiredString(value.updatedAt, "updatedAt") }), eventCursor: value.eventCursor === undefined ? 0 : requiredNumber(value.eventCursor, "eventCursor") };
}
export function decodeStatus(value, fallbackSessionId) {
    if (!isRecord(value))
        throw new TypeError("Session status must be an object");
    const pendingPermissionIds = requiredArray(value.pendingPermissionIDs ?? value.pendingPermissionIds, "pending permissions").map((item) => requiredString(item, "permission id"));
    const questions = value.pendingQuestionIDs ?? value.pendingQuestionIds;
    return { sessionId: typeof (value.sessionID ?? value.sessionId) === "string" ? String(value.sessionID ?? value.sessionId) : fallbackSessionId, running: requiredBoolean(value.running, "running"), pendingPermissionIds, ...(questions === undefined || questions === null ? {} : { pendingQuestionIds: requiredArray(questions, "pending questions").map((item) => requiredString(item, "question id")) }), subscribers: requiredNumber(value.subscribers, "subscribers"), ...(value.runStartedAt === undefined || value.runStartedAt === null ? {} : { runStartedAt: requiredString(value.runStartedAt, "runStartedAt") }), ...(value.accounting === undefined || value.accounting === null ? {} : { accounting: decodeAccounting(value.accounting) }), ...(value.queuedMessageCount === undefined || value.queuedMessageCount === null ? {} : { queuedMessageCount: requiredNumber(value.queuedMessageCount, "queuedMessageCount") }), ...(value.steeringMode === undefined || value.steeringMode === null ? {} : { steeringMode: String(value.steeringMode) }), ...(value.mode === undefined || value.mode === null ? {} : { mode: String(value.mode) }), ...(value.agent === undefined || value.agent === null ? {} : { agent: String(value.agent) }) };
}
export function decodeAccounting(value) {
    if (!isRecord(value))
        throw new TypeError("Accounting must be an object");
    const rawCost = value.costTotal;
    const costTotal = typeof rawCost === "string" || typeof rawCost === "number" ? asDecimalString(String(rawCost)) : asDecimalString("0");
    return { costTotal, contextTokens: requiredNumber(value.contextTokens ?? 0, "contextTokens"), turns: requiredNumber(value.turns ?? 0, "turns"), ...(value.contextWindow === undefined || value.contextWindow === null ? {} : { contextWindow: requiredNumber(value.contextWindow, "contextWindow") }), ...(isRecord(value.usage) ? { usage: { input: requiredNumber(value.usage.input ?? 0, "usage.input"), output: requiredNumber(value.usage.output ?? 0, "usage.output"), cacheRead: requiredNumber(value.usage.cacheRead ?? 0, "usage.cacheRead"), cacheWrite: requiredNumber(value.usage.cacheWrite ?? 0, "usage.cacheWrite") } } : {}) };
}
function sessionPath(id, suffix = "") { return `/session/${encodePathSegment(id)}${suffix}`; }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function decodeDirectToolResult(value) {
    if (!isRecord(value))
        throw new TypeError("Direct tool result must be an object");
    return {
        toolName: requiredString(value.toolName, "toolName"),
        output: requiredString(value.output, "output"),
        isError: requiredBoolean(value.isError, "isError"),
        imageCount: requiredNumber(value.imageCount ?? 0, "imageCount")
    };
}
//# sourceMappingURL=session.js.map