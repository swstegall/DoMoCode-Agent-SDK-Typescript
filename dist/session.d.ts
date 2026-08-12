import { EventEngine, type EventListener } from "./eventEngine.ts";
import { type ImageBlock, type Message } from "./types/messages.ts";
import { type ServerEvent } from "./types/events.ts";
import type { QuestionAnswer } from "./types/asks.ts";
import { type ClientToolHandler, type ClientToolHandlerOptions, type ClientToolDefinition } from "./types/tools.ts";
import { type JSONValue } from "./types/common.ts";
import type { ContextSnapshot, DirectToolResult, GitDiff, RunResult, SessionAccounting, SessionClientAttachment, SessionClientEvent, SessionClientJournalEntry, SessionRef, SessionStatus, SessionTreeEntry, WorkspaceHistoryResult, WorkspaceSnapshotStatus } from "./types/sessions.ts";
import type { DoMoCodeClient } from "./client.ts";
import { InteractionRuntime, type InteractionHandler, type InteractionRuntimeOptions, type RuntimeInteraction } from "./interactionRuntime.ts";
import type { ToolCatalogEntry, ToolCatalogFilter } from "./types/catalogs.ts";
import { type TranscriptOptions } from "./transcript.ts";
import { SubagentRegistry, type SubagentRegistryOptions } from "./subagents.ts";
export type AuthorityPreference = "require" | "prefer" | "observer";
export interface SessionAttachOptions {
    authority?: AuthorityPreference;
    clientTools?: readonly ClientToolDefinition[];
}
export interface SessionAcquireOptions extends SessionAttachOptions {
    mode?: "exclusive" | "shared";
}
export interface PromptOptions {
    images?: ImageBlock[];
}
export interface SendOptions extends PromptOptions {
    preferSteer?: boolean;
}
export interface SettleOptions {
    maxIdleMs?: number;
}
export interface SettleResult {
    stopReason: string;
    status: SessionStatus;
}
export interface TaskOptions {
    taskId?: string;
    agent?: string;
    background?: boolean;
    model?: string;
}
export type PromptCommandArguments = Record<string, string>;
export type McpResourceAction = "list" | "templates" | "read" | "health";
export interface McpResourceOptions {
    server?: string;
    uri?: string;
}
export declare class SessionHandle {
    readonly client: DoMoCodeClient;
    private ref;
    private readonly forget;
    private attachment;
    private engine;
    private disposed;
    private runLock;
    private leaseRelease;
    private leaseMode;
    private cursor;
    private interactionRuntime;
    private subagentRegistry;
    private clientToolSubscription;
    private readonly activeClientTools;
    constructor(client: DoMoCodeClient, ref: SessionRef, forget: () => void);
    get id(): string;
    get path(): string;
    get role(): SessionClientAttachment["role"] | undefined;
    get clientAttachment(): SessionClientAttachment | undefined;
    get eventsEngine(): EventEngine | undefined;
    setLease(mode: "exclusive" | "shared", release: () => void): void;
    release(): Promise<void>;
    attach(options?: SessionAttachOptions): Promise<SessionClientAttachment>;
    events(): EventEngine;
    onEvent(listener: EventListener): () => void;
    /**
     * Execute model calls for tools registered by the client and post their
     * results back to the owning session. Only one handler is active per handle;
     * registering a new one cleanly replaces the previous handler.
     */
    onToolCall(handler: ClientToolHandler, options?: ClientToolHandlerOptions): () => void;
    /** Return the session's single interaction dispatcher, creating it lazily. */
    interactionRuntimeFor(options?: InteractionRuntimeOptions): InteractionRuntime;
    interactions(options?: InteractionRuntimeOptions): AsyncIterableIterator<RuntimeInteraction>;
    onInteraction(handler: InteractionHandler, options?: InteractionRuntimeOptions): () => void;
    /** Return the live subagent index; child streams are observed by default. */
    subagents(options?: SubagentRegistryOptions): SubagentRegistry;
    prompt(text: string, options?: PromptOptions): Promise<void>;
    steer(text: string, options?: PromptOptions): Promise<void>;
    /** Invoke a server-owned prompt command through the normal prompt channel. */
    invokePromptCommand(name: string, argumentsValue?: PromptCommandArguments): Promise<void>;
    send(text: string, options?: SendOptions): Promise<void>;
    abort(): Promise<boolean>;
    forceClear(): Promise<boolean>;
    status(): Promise<SessionStatus>;
    accounting(): Promise<SessionAccounting | undefined>;
    messages(): Promise<Message[]>;
    transcript(options?: TranscriptOptions): Promise<string>;
    context(): Promise<ContextSnapshot>;
    setModel(modelId: string): Promise<void>;
    setMode(mode: string): Promise<void>;
    fork(options?: SessionAttachOptions): Promise<SessionHandle>;
    clone(options?: SessionAttachOptions): Promise<SessionHandle>;
    rename(name: string | null): Promise<void>;
    autoTitle(): Promise<string | undefined>;
    setLabel(targetId: string, label: string | null): Promise<void>;
    moveLeaf(targetId: string | null): Promise<void>;
    commitMessage(): Promise<string | undefined>;
    tools(filter?: ToolCatalogFilter): Promise<ToolCatalogEntry[]>;
    /**
     * Compatibility path for MCP resources on servers before the MCP admin routes.
     * The server still owns MCP connections and returns its bounded direct-tool result.
     */
    mcpResource(action: McpResourceAction, options?: McpResourceOptions): Promise<DirectToolResult>;
    executeTool(name: string, argumentsValue?: Record<string, JSONValue>): Promise<DirectToolResult>;
    executeToolCommand(command: string): Promise<DirectToolResult>;
    task(prompt: string, options?: TaskOptions): Promise<DirectToolResult>;
    resumeTask(taskId: string, prompt?: string, options?: Omit<TaskOptions, "taskId">): Promise<DirectToolResult>;
    answerPermission(requestId: string, reply: "once" | "always" | "reject", message?: string): Promise<void>;
    answerQuestion(requestId: string, answers: QuestionAnswer[] | null): Promise<void>;
    pendingPermissions(): Promise<ServerEvent[]>;
    pendingQuestions(): Promise<ServerEvent[]>;
    settled(options?: SettleOptions): Promise<SettleResult>;
    run(prompt: string, options?: PromptOptions & SettleOptions): Promise<RunResult>;
    attachAuthority(): Promise<SessionClientAttachment>;
    requestAuthority(): Promise<SessionClientAttachment>;
    releaseAuthority(): Promise<SessionClientAttachment>;
    transferAuthority(toClientId: string): Promise<SessionClientAttachment>;
    authority(): Promise<SessionClientAttachment | undefined>;
    clients(includeInactive?: boolean): Promise<SessionClientAttachment[]>;
    clientEvents(after?: number): Promise<SessionClientEvent[]>;
    clientJournal(clientId?: string): Promise<SessionClientJournalEntry[]>;
    advanceCursor(sequence?: number): Promise<SessionClientAttachment>;
    diff(base?: string): Promise<GitDiff>;
    workspaceStatus(): Promise<WorkspaceSnapshotStatus>;
    undo(): Promise<WorkspaceHistoryResult>;
    redo(): Promise<WorkspaceHistoryResult>;
    children(parent?: string): Promise<SessionTreeEntry[]>;
    tree(): Promise<SessionTreeEntry[]>;
    timeline(): Promise<SessionTreeEntry[]>;
    compact(): Promise<boolean>;
    dispose(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
    private postPrompt;
    private pendingInteractionPayloads;
    private reconcile;
    private resolveClientTool;
    private executeClientTool;
    private assertUsable;
}
export declare function decodeAttachment(value: unknown, fallbackSessionId: string): SessionClientAttachment;
export declare function decodeStatus(value: unknown, fallbackSessionId: string): SessionStatus;
export declare function decodeAccounting(value: unknown): SessionAccounting;
//# sourceMappingURL=session.d.ts.map