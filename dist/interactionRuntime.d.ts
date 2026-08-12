import type { OAuthRequestEvent } from "./types/events.ts";
import type { OAuthInteraction, PermissionRequest, QuestionAnswer, QuestionPrompt } from "./types/asks.ts";
import type { SessionHandle } from "./session.ts";
export type Decline = "decline";
export type InteractionHandler = (ask: RuntimeInteraction) => Promise<void | Decline> | void | Decline;
export interface PermissionAsk extends PermissionRequest {
    kind: "permission";
    signal: AbortSignal;
    allow(options?: {
        always?: boolean;
    }): Promise<void>;
    deny(message?: string): Promise<void>;
    decline(): void;
}
export interface QuestionAsk {
    kind: "question";
    id: string;
    sessionId: string;
    questions: QuestionPrompt[];
    signal: AbortSignal;
    answer(answers: QuestionAnswer[]): Promise<void>;
    cancel(): Promise<void>;
    decline(): void;
}
export interface OAuthAsk extends OAuthInteraction {
}
export interface UnknownAsk {
    kind: string;
    id: string;
    sessionId?: string;
    raw: unknown;
    signal: AbortSignal;
    decline(): void;
}
export type RuntimeInteraction = PermissionAsk | QuestionAsk | OAuthAsk | UnknownAsk;
export interface PermissionPolicyOptions {
    rules?: Array<{
        pattern: string;
        action: "allow" | "deny" | "ask";
    }>;
    default?: "allow" | "deny" | "ask";
    timeout?: {
        after: number;
        action: "allow" | "deny";
    };
}
export interface InteractionPolicy {
    permission?: (ask: PermissionAsk) => Promise<void>;
    question?: (ask: QuestionAsk) => Promise<void>;
    oauth?: (ask: OAuthAsk) => Promise<void>;
}
export interface InteractionRuntimeOptions {
    /** Permit `ask.allow({always: true})`, which writes a durable server rule. */
    allowPersistentGrants?: boolean;
    /** Receives warnings for unhandled or stalled interactions. */
    warn?: (message: string) => void;
    /** Time before an unanswered interaction receives its second warning. */
    idleMs?: number;
    /** Fallback policy used after explicit handlers and iterators decline an ask. */
    policy?: InteractionPolicy;
    /** Include server-scoped OAuth requests in this dispatcher. */
    includeOAuth?: boolean;
    /** Opens an authorization URL. Kept injectable for Node and browser hosts. */
    openOAuth?: (authorizationUrl: string) => Promise<boolean> | boolean;
}
/** Interaction registry and dispatcher for one or more session streams. */
export declare class InteractionRuntime {
    private readonly entries;
    private readonly controllers;
    private readonly handlers;
    private readonly queue;
    private readonly unsubs;
    private readonly dispatching;
    private readonly options;
    constructor(options?: InteractionRuntimeOptions);
    /** Subscribe to a session and hydrate asks that predate the subscription. */
    attach(session: SessionHandle): Promise<() => void>;
    pending(): RuntimeInteraction[];
    /** Admit a server-scoped OAuth request recovered from `/oauth/pending`. */
    acceptOAuth(event: OAuthRequestEvent): void;
    interactions(): AsyncIterableIterator<RuntimeInteraction>;
    /** Add an explicit handler. Newer handlers run first. */
    onInteraction(handler: InteractionHandler): () => void;
    close(): void;
    private accept;
    private claim;
    private dispatch;
    private waitForClaim;
    private warnUnhandled;
    private warnStillPending;
    private permission;
    private question;
    private oauth;
    private unknown;
    private resolve;
    private isPending;
    private key;
}
export declare function permissionPolicy(options?: PermissionPolicyOptions): InteractionPolicy;
export declare function yolo(): InteractionPolicy;
export declare function wildcardMatch(pattern: string, value: string): boolean;
//# sourceMappingURL=interactionRuntime.d.ts.map