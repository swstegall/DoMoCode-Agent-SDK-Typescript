import { Transport, type TransportOptions } from "./transport.ts";
import type { ServerCapabilities, SessionRef, SessionSummary } from "./types/sessions.ts";
import type { CatalogSnapshot } from "./types/catalogs.ts";
import { SessionHandle, type SessionAcquireOptions, type SessionAttachOptions } from "./session.ts";
import { CatalogClient, type ModelCatalogOptions } from "./catalogs.ts";
import { WorkflowClient } from "./workflows.ts";
import { JobClient } from "./jobs.ts";
import { HandoffClient } from "./handoffs.ts";
import { AutomationClient } from "./automations.ts";
import { McpClient } from "./mcp.ts";
import { type InteractionHandler, type InteractionRuntimeOptions, type RuntimeInteraction } from "./interactionRuntime.ts";
export interface DoMoCodeClientOptions extends TransportOptions {
}
export interface CatalogOptions extends ModelCatalogOptions {
    session?: SessionHandle;
    includeSkillBody?: boolean;
}
export declare class DoMoCodeClient {
    readonly transport: Transport;
    readonly sessions: SessionRegistry;
    readonly catalogs: CatalogClient;
    readonly workflows: WorkflowClient;
    readonly jobs: JobClient;
    readonly handoffs: HandoffClient;
    readonly automations: AutomationClient;
    readonly mcp: McpClient;
    private clientInteractionRuntime;
    constructor(options: DoMoCodeClientOptions);
    get baseURL(): string;
    get clientId(): string;
    get owner(): string;
    /**
     * Read the global command/skill/agent/model inventory in one call. Tools are
     * session-scoped; pass an already-open handle to include that live view.
     */
    catalog(options?: CatalogOptions): Promise<CatalogSnapshot>;
    /** Aggregate permission, question, and server-scoped OAuth asks across sessions. */
    interactions(options?: InteractionRuntimeOptions): AsyncIterableIterator<RuntimeInteraction>;
    onInteraction(handler: InteractionHandler, options?: InteractionRuntimeOptions): () => void;
    pendingInteractions(options?: InteractionRuntimeOptions): RuntimeInteraction[];
    /** @internal Register an attached session with the client-level dispatcher. */
    registerSession(session: SessionHandle): void;
    private interactionRuntimeFor;
    private refreshOAuthPending;
    capabilities(): Promise<ServerCapabilities | undefined>;
    close(): Promise<void>;
}
export declare class SessionRegistry {
    private readonly client;
    private readonly handles;
    private readonly exclusiveLeases;
    constructor(client: DoMoCodeClient);
    list(): Promise<SessionSummary[]>;
    create(options?: SessionAttachOptions): Promise<SessionHandle>;
    resume(id: string, options?: SessionAttachOptions): Promise<SessionHandle>;
    open(id: string, options?: SessionAttachOptions): Promise<SessionHandle>;
    acquire(id: string, options?: SessionAcquireOptions): Promise<SessionHandle>;
    forget(id: string): void;
    close(): Promise<void>;
    getOrCreate(ref: SessionRef): SessionHandle;
    all(): SessionHandle[];
    releaseLease(id: string): void;
    private openRef;
}
export declare function decodeSessionRef(value: unknown): SessionRef;
export declare function decodeSessionSummary(value: unknown): SessionSummary;
export declare function sessionPath(id: string, suffix?: string): string;
//# sourceMappingURL=client.d.ts.map