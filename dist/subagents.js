import { InteractionRuntime } from "./interactionRuntime.js";
/** Live parent-to-child task index with child-stream interaction safety. */
export class SubagentRegistry {
    parent;
    ready;
    recordsByTask = new Map();
    childrenByTask = new Map();
    listeners = new Set();
    interactionRuntime;
    unsubscribeParent;
    closed = false;
    options;
    constructor(parent, options = {}) {
        this.parent = parent;
        this.options = options;
        this.interactionRuntime = new InteractionRuntime(options.interactions);
        this.unsubscribeParent = parent.onEvent((event) => {
            if (event.type === "subagent" && "subagent" in event)
                this.accept(event.subagent);
        });
        this.ready = this.interactionRuntime.attach(parent).then(() => undefined);
    }
    snapshot() { return [...this.recordsByTask.values()].map(copyRecord); }
    get(taskId) {
        const record = this.recordsByTask.get(taskId);
        return record ? copyRecord(record) : undefined;
    }
    child(taskId) { return this.childrenByTask.get(taskId); }
    onUpdate(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    interactions() { return this.interactionRuntime.interactions(); }
    onInteraction(handler) { return this.interactionRuntime.onInteraction(handler); }
    pendingInteractions() { return this.interactionRuntime.pending(); }
    async openChild(taskId) {
        const record = this.recordsByTask.get(taskId);
        if (!record || this.closed)
            return undefined;
        return this.observeChild(record);
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        this.unsubscribeParent();
        this.interactionRuntime.close();
        const children = [...this.childrenByTask.values()];
        this.childrenByTask.clear();
        await Promise.all(children.map((child) => child.dispose().catch(() => undefined)));
    }
    accept(event) {
        if (this.closed)
            return;
        const record = {
            taskId: event.taskId,
            childSessionId: event.childSessionId,
            depth: event.depth,
            status: event.status,
            ...(event.parentSessionId === undefined ? {} : { parentSessionId: event.parentSessionId }),
            ...(event.description === undefined ? {} : { description: event.description }),
            ...(event.prompt === undefined ? {} : { prompt: event.prompt }),
            ...(event.agent === undefined ? {} : { agent: event.agent }),
            ...(event.mode === undefined ? {} : { mode: event.mode }),
            ...(event.model === undefined ? {} : { model: event.model }),
            ...(event.toolAllowlist === undefined ? {} : { toolAllowlist: [...event.toolAllowlist] }),
            ...(event.output === undefined ? {} : { output: event.output }),
            ...(event.error === undefined ? {} : { error: event.error })
        };
        this.recordsByTask.set(record.taskId, record);
        const copied = copyRecord(record);
        for (const listener of this.listeners)
            listener(copied);
        if (this.options.observeChildren !== false && ["started", "accepted", "running"].includes(record.status))
            void this.observeChild(record);
    }
    async observeChild(record) {
        const existing = this.childrenByTask.get(record.taskId);
        if (existing)
            return existing;
        try {
            const child = await this.parent.client.sessions.open(record.childSessionId, { authority: this.options.childAuthority ?? "prefer" });
            if (this.closed) {
                await child.dispose();
                return undefined;
            }
            this.childrenByTask.set(record.taskId, child);
            await this.interactionRuntime.attach(child);
            return child;
        }
        catch (error) {
            this.options.warn?.(`DoMoCode child session ${record.childSessionId} could not be observed: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }
}
function copyRecord(record) {
    return { ...record, ...(record.toolAllowlist === undefined ? {} : { toolAllowlist: [...record.toolAllowlist] }) };
}
//# sourceMappingURL=subagents.js.map