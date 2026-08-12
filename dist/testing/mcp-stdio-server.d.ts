export interface McpFixtureTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}
export interface McpFixtureResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
    contents?: unknown[];
}
export interface McpFixtureResourceTemplate {
    uriTemplate: string;
    name: string;
    description?: string;
    mimeType?: string;
}
export interface McpFixturePrompt {
    name: string;
    description?: string;
    arguments?: Array<Record<string, unknown>>;
}
export interface McpStdioServerOptions {
    name?: string;
    version?: string;
    protocolVersion?: string;
    tools?: McpFixtureTool[];
    resources?: McpFixtureResource[];
    resourceTemplates?: McpFixtureResourceTemplate[];
    prompts?: McpFixturePrompt[];
}
export interface McpStdioServerCommand {
    command: string;
    args: string[];
    env?: Record<string, string>;
}
/** A deterministic MCP JSON-RPC peer used by Node and live-server tests. */
export declare class McpStdioServer {
    readonly options: McpStdioServerOptions;
    constructor(options?: McpStdioServerOptions);
    handle(request: unknown): Record<string, unknown> | undefined;
    line(line: string): string | undefined;
    private result;
    private error;
}
export declare function mcpStdioServerCommand(options?: McpStdioServerOptions): McpStdioServerCommand;
export declare function mcpStdioSettingsSnippet(options?: McpStdioServerOptions): string;
//# sourceMappingURL=mcp-stdio-server.d.ts.map