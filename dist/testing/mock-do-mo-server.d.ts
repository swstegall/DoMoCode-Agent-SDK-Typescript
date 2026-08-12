import type { FetchFunction } from "../transport.ts";
import { Transport } from "../transport.ts";
import type { ServerEvent } from "../types/events.ts";
import type { Message } from "../types/messages.ts";
import type { SessionRef } from "../types/sessions.ts";
export interface MockPromptContext {
    sessionId: string;
    prompt: string;
    images: unknown[];
    server: MockDoMoServer;
}
export interface MockPromptResult {
    message?: Message;
    events?: ServerEvent[];
    stopReason?: string;
}
export interface MockDoMoServerOptions {
    token?: string;
    protocolVersion?: number;
    version?: string;
    autoComplete?: boolean;
    promptHandler?: (context: MockPromptContext) => Promise<MockPromptResult | void> | MockPromptResult | void;
    capabilities?: string[];
}
/**
 * A deterministic, protocol-shaped in-process DoMoCode server.
 *
 * It intentionally implements the same fetch seam as a browser/server runtime:
 * pass `server.fetch` to `Transport`, or use `server.transport()`. No TCP or
 * Node-only API is required, which keeps it suitable for browser tests too.
 */
export declare class MockDoMoServer {
    readonly token: string;
    readonly baseURL = "http://mock.domocode.test";
    readonly protocolVersion: number;
    readonly version: string;
    readonly capabilities: string[];
    readonly fetch: FetchFunction;
    private readonly autoComplete;
    private readonly promptHandler;
    private readonly sessionsById;
    private closed;
    constructor(options?: MockDoMoServerOptions);
    transport(options?: Partial<Omit<ConstructorParameters<typeof Transport>[0], "baseURL" | "token" | "fetch">>): Transport;
    session(id: string): SessionRef | undefined;
    createSession(resume?: string): Promise<SessionRef>;
    emit(sessionId: string, event: ServerEvent): number;
    requestPermission(sessionId: string, request: Omit<Extract<ServerEvent, {
        type: "permission_request";
    }>, "type">): Promise<void>;
    requestQuestion(sessionId: string, request: Omit<Extract<ServerEvent, {
        type: "question_request";
    }>, "type">): Promise<void>;
    close(): void;
    private handleFetch;
    private handleGlobal;
    private openEvents;
    private enqueue;
    private prompt;
    private runPrompt;
    private finishMockRun;
    private steer;
    private answerPermission;
    private answerQuestion;
    private executeTool;
    private fork;
    private attach;
    private detach;
    private advanceCursor;
    private releaseAuthority;
    private transferAuthority;
    private tools;
    private status;
    private isAuthority;
    private requireSession;
}
//# sourceMappingURL=mock-do-mo-server.d.ts.map