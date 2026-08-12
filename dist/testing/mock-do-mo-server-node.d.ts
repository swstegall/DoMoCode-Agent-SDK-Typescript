import { MockDoMoServer } from "./mock-do-mo-server.ts";
export interface MockDoMoTcpServerOptions {
    server?: MockDoMoServer;
    host?: string;
    port?: number;
}
/**
 * Node-only TCP adapter for the browser-safe MockDoMoServer.
 *
 * The protocol implementation remains backed by the mock's `fetch` seam; this
 * adapter only translates Node HTTP requests and streaming responses. Keeping
 * that boundary separate prevents node:http from leaking into the root SDK.
 */
export declare class MockDoMoTcpServer {
    readonly server: MockDoMoServer;
    readonly host: string;
    readonly port: number;
    readonly baseURL: string;
    private readonly httpServer;
    private closed;
    private constructor();
    static start(options?: MockDoMoTcpServerOptions): Promise<MockDoMoTcpServer>;
    close(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
}
/** Alias with the acronym capitalized for callers that prefer TCP casing. */
export declare const MockDoMoTCPServer: typeof MockDoMoTcpServer;
//# sourceMappingURL=mock-do-mo-server-node.d.ts.map