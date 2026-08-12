import { type InteractionHandler, type InteractionRuntimeOptions, type RuntimeInteraction } from "./interactionRuntime.ts";
import type { SessionHandle } from "./session.ts";
import type { SubagentStatus } from "./types/events.ts";
export interface SubagentRecord {
    taskId: string;
    childSessionId: string;
    parentSessionId?: string;
    depth: number;
    status: SubagentStatus;
    description?: string;
    prompt?: string;
    agent?: string;
    mode?: string;
    model?: string;
    toolAllowlist?: string[];
    output?: string;
    error?: string;
}
export interface SubagentRegistryOptions {
    /** Open each child stream. Enabled by default; authority preference controls answering. */
    observeChildren?: boolean;
    /** Authority preference for child answers. `prefer` can answer when no other client owns the child. */
    childAuthority?: "prefer" | "observer" | "require";
    interactions?: InteractionRuntimeOptions;
    warn?: (message: string) => void;
}
/** Live parent-to-child task index with child-stream interaction safety. */
export declare class SubagentRegistry {
    private readonly parent;
    readonly ready: Promise<void>;
    private readonly recordsByTask;
    private readonly childrenByTask;
    private readonly listeners;
    private readonly interactionRuntime;
    private readonly unsubscribeParent;
    private closed;
    private readonly options;
    constructor(parent: SessionHandle, options?: SubagentRegistryOptions);
    snapshot(): SubagentRecord[];
    get(taskId: string): SubagentRecord | undefined;
    child(taskId: string): SessionHandle | undefined;
    onUpdate(listener: (record: SubagentRecord) => void): () => void;
    interactions(): AsyncIterableIterator<RuntimeInteraction>;
    onInteraction(handler: InteractionHandler): () => void;
    pendingInteractions(): RuntimeInteraction[];
    openChild(taskId: string): Promise<SessionHandle | undefined>;
    close(): Promise<void>;
    private accept;
    private observeChild;
}
//# sourceMappingURL=subagents.d.ts.map