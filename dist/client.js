import { Transport, encodePathSegment } from "./transport.js";
import { NotFoundError, SessionAlreadyAcquiredError } from "./types/errors.js";
import { SessionHandle } from "./session.js";
import { isRecord, requiredString } from "./types/common.js";
import { decodeServerEvent } from "./types/events.js";
import { CatalogClient } from "./catalogs.js";
import { WorkflowClient } from "./workflows.js";
import { JobClient } from "./jobs.js";
import { HandoffClient } from "./handoffs.js";
import { AutomationClient } from "./automations.js";
import { McpClient } from "./mcp.js";
import { InteractionRuntime } from "./interactionRuntime.js";
export class DoMoCodeClient {
    transport;
    sessions;
    catalogs;
    workflows;
    jobs;
    handoffs;
    automations;
    mcp;
    clientInteractionRuntime;
    constructor(options) {
        this.transport = new Transport(options);
        this.sessions = new SessionRegistry(this);
        this.catalogs = new CatalogClient(this.transport);
        this.workflows = new WorkflowClient(this.transport);
        this.jobs = new JobClient(this.transport);
        this.handoffs = new HandoffClient(this.transport);
        this.automations = new AutomationClient(this.transport);
        this.mcp = new McpClient(this.transport);
    }
    get baseURL() { return this.transport.baseURL; }
    get clientId() { return this.transport.clientId; }
    get owner() { return this.transport.owner; }
    /**
     * Read the global command/skill/agent/model inventory in one call. Tools are
     * session-scoped; pass an already-open handle to include that live view.
     */
    async catalog(options = {}) {
        const [commands, skills, agents, models] = await Promise.all([
            this.catalogs.commands(),
            this.catalogs.skills(options.includeSkillBody ? { includeBody: true } : {}),
            this.catalogs.agents(),
            this.catalogs.models(options)
        ]);
        const tools = options.session ? await options.session.tools() : [];
        return { tools, commands: commands.commands, skills, agents, models };
    }
    /** Aggregate permission, question, and server-scoped OAuth asks across sessions. */
    interactions(options = {}) {
        const runtime = this.interactionRuntimeFor(options);
        void this.refreshOAuthPending(runtime);
        return runtime.interactions();
    }
    onInteraction(handler, options = {}) {
        const runtime = this.interactionRuntimeFor(options);
        void this.refreshOAuthPending(runtime);
        return runtime.onInteraction(handler);
    }
    pendingInteractions(options = {}) {
        return this.interactionRuntimeFor(options).pending();
    }
    /** @internal Register an attached session with the client-level dispatcher. */
    registerSession(session) {
        if (!this.clientInteractionRuntime || !session.eventsEngine)
            return;
        void this.clientInteractionRuntime.attach(session).catch(() => undefined);
    }
    interactionRuntimeFor(options) {
        if (!this.clientInteractionRuntime) {
            this.clientInteractionRuntime = new InteractionRuntime({ ...options, includeOAuth: true });
            for (const session of this.sessions.all())
                this.registerSession(session);
        }
        return this.clientInteractionRuntime;
    }
    async refreshOAuthPending(runtime) {
        try {
            const value = await this.transport.json("/oauth/pending");
            if (!Array.isArray(value))
                return;
            for (const item of value) {
                const event = decodeServerEvent(item);
                if (event.type === "oauth_request" && "authorizationUrl" in event)
                    runtime.acceptOAuth(event);
            }
        }
        catch (error) {
            if (!(error instanceof NotFoundError))
                return;
        }
    }
    async capabilities() {
        try {
            const value = await this.transport.json("/capabilities");
            if (!isRecord(value))
                throw new TypeError("Capabilities response must be an object");
            return { name: requiredString(value.name, "capabilities.name"), version: requiredString(value.version, "capabilities.version"), protocolVersion: typeof value.protocolVersion === "number" ? value.protocolVersion : 1, capabilities: Array.isArray(value.capabilities) ? value.capabilities.map((item) => requiredString(item, "capability")) : [] };
        }
        catch (error) {
            if (error instanceof NotFoundError)
                return;
            throw error;
        }
    }
    async close() {
        this.clientInteractionRuntime?.close();
        this.clientInteractionRuntime = undefined;
        await this.sessions.close();
    }
}
export class SessionRegistry {
    client;
    handles = new Map();
    exclusiveLeases = new Set();
    constructor(client) {
        this.client = client;
    }
    async list() {
        const value = await this.client.transport.json("/sessions");
        if (!Array.isArray(value))
            throw new TypeError("Session list must be an array");
        return value.map(decodeSessionSummary);
    }
    async create(options = {}) {
        const value = await this.client.transport.json("/session", { method: "POST", body: {} });
        const ref = decodeSessionRef(value);
        return this.openRef(ref, options);
    }
    async resume(id, options = {}) {
        const value = await this.client.transport.json("/session", { method: "POST", body: { resume: id } });
        const ref = decodeSessionRef(value);
        return this.openRef(ref, options);
    }
    async open(id, options = {}) {
        const existing = this.handles.get(id);
        if (existing) {
            await existing.attach(options);
            return existing;
        }
        return this.resume(id, options);
    }
    async acquire(id, options = {}) {
        const mode = options.mode ?? "exclusive";
        if (mode === "exclusive" && this.exclusiveLeases.has(id))
            throw new SessionAlreadyAcquiredError(id);
        const handle = await this.open(id, options);
        if (mode === "exclusive")
            this.exclusiveLeases.add(id);
        handle.setLease(mode, () => { if (mode === "exclusive")
            this.exclusiveLeases.delete(id); });
        return handle;
    }
    forget(id) { this.handles.delete(id); this.exclusiveLeases.delete(id); }
    async close() {
        const handles = [...this.handles.values()];
        for (const handle of handles)
            await handle.dispose();
        this.handles.clear();
        this.exclusiveLeases.clear();
    }
    getOrCreate(ref) {
        const existing = this.handles.get(ref.id);
        if (existing)
            return existing;
        const handle = new SessionHandle(this.client, ref, () => this.forget(ref.id));
        this.handles.set(ref.id, handle);
        return handle;
    }
    all() { return [...this.handles.values()]; }
    releaseLease(id) { this.exclusiveLeases.delete(id); }
    async openRef(ref, options) {
        const handle = this.getOrCreate(ref);
        await handle.attach(options);
        this.client.registerSession(handle);
        return handle;
    }
}
export function decodeSessionRef(value) {
    if (!isRecord(value))
        throw new TypeError("Session reference must be an object");
    return { id: requiredString(value.id, "session.id"), path: requiredString(value.path, "session.path") };
}
export function decodeSessionSummary(value) {
    if (!isRecord(value))
        throw new TypeError("Session summary must be an object");
    return { id: requiredString(value.id, "session.id"), path: requiredString(value.path, "session.path"), cwd: requiredString(value.cwd, "session.cwd"), timestamp: requiredString(value.timestamp, "session.timestamp"), ...(value.name === undefined || value.name === null ? {} : { name: requiredString(value.name, "session.name") }), ...(value.parentSession === undefined || value.parentSession === null ? {} : { parentSession: requiredString(value.parentSession, "session.parentSession") }) };
}
export function sessionPath(id, suffix = "") {
    return `/session/${encodePathSegment(id)}${suffix}`;
}
//# sourceMappingURL=client.js.map