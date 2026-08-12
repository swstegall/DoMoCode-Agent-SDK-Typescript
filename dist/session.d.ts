import { EventEngine, type EventListener } from "./eventEngine.ts";
import { type ImageBlock, type Message } from "./types/messages.ts";
import { type ServerEvent } from "./types/events.ts";
import type { QuestionAnswer } from "./types/asks.ts";
import { type JSONValue } from "./types/common.ts";
import type { ContextSnapshot, DirectToolResult, GitDiff, RunResult, SessionAccounting, SessionClientAttachment, SessionClientEvent, SessionClientJournalEntry, SessionRef, SessionStatus, SessionTreeEntry, WorkspaceHistoryResult, WorkspaceSnapshotStatus } from "./types/sessions.ts";
import type { DoMoCodeClient } from "./client.ts";
import { InteractionRuntime, type InteractionHandler, type InteractionRuntimeOptions, type RuntimeInteraction } from "./interactionRuntime.ts";
import type { ToolCatalogEntry } from "./types/catalogs.ts";
import { type TranscriptOptions } from "./transcript.ts";
export type AuthorityPreference = "require" | "prefer" | "observer";
export interface SessionAttachOptions {
    authority?: AuthorityPreference;
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
    /** Return the session's single interaction dispatcher, creating it lazily. */
    interactionRuntimeFor(options?: InteractionRuntimeOptions): InteractionRuntime;
    interactions(options?: InteractionRuntimeOptions): AsyncIterableIterator<RuntimeInteraction>;
    onInteraction(handler: InteractionHandler, options?: InteractionRuntimeOptions): () => void;
    prompt(text: string, options?: PromptOptions): Promise<void>;
    steer(text: string, options?: PromptOptions): Promise<void>;
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
    tools(): Promise<ToolCatalogEntry[]>;
    executeTool(name: string, argumentsValue?: Record<string, JSONValue>): Promise<DirectToolResult>;
    executeToolCommand(command: string): Promise<DirectToolResult>;
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
    private assertUsable;
}
export declare function decodeAttachment(value: unknown, fallbackSessionId: string): SessionClientAttachment;
export declare function decodeStatus(value: unknown, fallbackSessionId: string): SessionStatus;
export declare function decodeAccounting(value: unknown): SessionAccounting;
//# sourceMappingURL=session.d.ts.map