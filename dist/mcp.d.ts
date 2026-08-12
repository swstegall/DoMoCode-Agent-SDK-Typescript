import type { Transport } from "./transport.ts";
import type { McpResourceInfo, McpResourceRead, McpResourceTemplateInfo, McpServerHealth, McpServerStatusInfo, McpServerStatusMap } from "./types/mcp.ts";
export interface McpClientOptions {
    maxAgeMs?: number;
}
/** Typed access to the process-scoped MCP admin routes.
 *
 * The SDK never speaks MCP JSON-RPC. The Swift server remains the connection
 * owner, and this client only consumes its redacted status/catalog projections.
 */
export declare class McpClient {
    private readonly transport;
    private readonly maxAgeMs;
    private serverCache;
    private readonly resourceCache;
    private readonly templateCache;
    constructor(transport: Transport, options?: McpClientOptions);
    servers(options?: McpClientOptions): Promise<McpServerStatusMap>;
    health(server: string): Promise<McpServerHealth[]>;
    resources(server: string, options?: McpClientOptions): Promise<McpResourceInfo[]>;
    resourceTemplates(server: string, options?: McpClientOptions): Promise<McpResourceTemplateInfo[]>;
    readResource(server: string, uri: string): Promise<McpResourceRead>;
    /** Invalidate status and catalog snapshots after an `mcp_changed` frame. */
    invalidate(server?: string): void;
}
export declare function decodeMcpServerStatusMap(value: unknown): McpServerStatusMap;
export declare function decodeMcpServerStatusInfo(value: unknown): McpServerStatusInfo;
export declare function decodeMcpResourceInfo(value: unknown): McpResourceInfo;
export declare function decodeMcpResourceTemplateInfo(value: unknown): McpResourceTemplateInfo;
export declare function decodeMcpResourceRead(value: unknown): McpResourceRead;
export declare function decodeMcpServerHealth(value: unknown): McpServerHealth;
//# sourceMappingURL=mcp.d.ts.map