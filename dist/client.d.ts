import { Transport, type TransportOptions } from "./transport.ts";
import type { ServerCapabilities, SessionRef, SessionSummary } from "./types/sessions.ts";
import { SessionHandle, type SessionAcquireOptions, type SessionAttachOptions } from "./session.ts";
import { CatalogClient } from "./catalogs.ts";
export interface DoMoCodeClientOptions extends TransportOptions {
}
export declare class DoMoCodeClient {
    readonly transport: Transport;
    readonly sessions: SessionRegistry;
    readonly catalogs: CatalogClient;
    constructor(options: DoMoCodeClientOptions);
    get baseURL(): string;
    get clientId(): string;
    get owner(): string;
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
    releaseLease(id: string): void;
    private openRef;
}
export declare function decodeSessionRef(value: unknown): SessionRef;
export declare function decodeSessionSummary(value: unknown): SessionSummary;
export declare function sessionPath(id: string, suffix?: string): string;
//# sourceMappingURL=client.d.ts.map