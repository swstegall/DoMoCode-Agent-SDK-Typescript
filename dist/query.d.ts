import { DoMoCodeClient } from "./client.ts";
import { type InteractionPolicy, type PermissionAsk, type QuestionAsk } from "./interactionRuntime.ts";
import type { SessionHandle, PromptOptions, SendOptions } from "./session.ts";
import type { ImageBlock, Message } from "./types/messages.ts";
import type { CommandRegistry, ToolCatalogEntry } from "./types/catalogs.ts";
import type { ServerCapabilities, SessionAccounting } from "./types/sessions.ts";
import type { ServerEvent } from "./types/events.ts";
import { type TranscriptOptions } from "./transcript.ts";
import type { FetchFunction } from "./transport.ts";
export interface QueryServerRef {
    baseURL: string;
    token: string;
    fetch?: FetchFunction;
}
export interface QueryOptions {
    prompt?: string;
    server?: DoMoCodeClient | QueryServerRef;
    baseURL?: string;
    token?: string;
    fetch?: FetchFunction;
    clientId?: string;
    owner?: string;
    session?: {
        resume?: string;
        fork?: boolean;
    };
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
export interface QueryInputOptions extends Omit<QueryOptions, "prompt"> {
}
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
    notices: Array<{
        level: string;
        code: string;
        text: string;
        detail?: string;
    }>;
    session?: SessionHandle;
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
export declare function query(options: QueryOptions): QueryStream;
export declare function query(prompts: AsyncIterable<string>, options?: QueryInputOptions): QueryStream;
export declare function runQuery(options: QueryOptions): Promise<QueryResult>;
export declare function runQuery(prompts: AsyncIterable<string>, options?: QueryInputOptions): Promise<QueryResult>;
//# sourceMappingURL=query.d.ts.map