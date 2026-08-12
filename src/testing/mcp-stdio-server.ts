import { fileURLToPath } from "node:url";

export interface McpFixtureTool { name: string; description?: string; inputSchema?: Record<string, unknown> }
export interface McpFixtureResource { uri: string; name: string; description?: string; mimeType?: string; contents?: unknown[] }
export interface McpFixtureResourceTemplate { uriTemplate: string; name: string; description?: string; mimeType?: string }
export interface McpFixturePrompt { name: string; description?: string; arguments?: Array<Record<string, unknown>> }
export interface McpStdioServerOptions {
  name?: string;
  version?: string;
  protocolVersion?: string;
  tools?: McpFixtureTool[];
  resources?: McpFixtureResource[];
  resourceTemplates?: McpFixtureResourceTemplate[];
  prompts?: McpFixturePrompt[];
}

export interface McpStdioServerCommand { command: string; args: string[]; env?: Record<string, string> }

const defaultOptions: Required<Pick<McpStdioServerOptions, "name" | "version" | "protocolVersion">> = {
  name: "domocode-mcp-fixture",
  version: "1.0.0",
  protocolVersion: "2025-06-18"
};

/** A deterministic MCP JSON-RPC peer used by Node and live-server tests. */
export class McpStdioServer {
  readonly options: McpStdioServerOptions;

  constructor(options: McpStdioServerOptions = {}) {
    this.options = { ...defaultOptions, ...options };
  }

  handle(request: unknown): Record<string, unknown> | undefined {
    if (!isRecord(request) || typeof request.method !== "string") return undefined;
    const id = request.id;
    const params = isRecord(request.params) ? request.params : {};
    switch (request.method) {
      case "initialize":
        return this.result(id, {
          protocolVersion: this.options.protocolVersion,
          capabilities: { tools: { listChanged: true }, resources: { listChanged: true }, prompts: { listChanged: true } },
          serverInfo: { name: this.options.name, version: this.options.version }
        });
      case "notifications/initialized":
        return undefined;
      case "ping":
        return this.result(id, {});
      case "tools/list":
        return this.result(id, { tools: (this.options.tools ?? [{ name: "echo", description: "Echo arguments", inputSchema: { type: "object" } }]).map((tool) => ({ name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema ?? { type: "object" } })) });
      case "tools/call":
        return this.result(id, { content: [{ type: "text", text: `fixture:${typeof params.name === "string" ? params.name : "unknown"}` }], isError: false });
      case "resources/list":
        return this.result(id, { resources: this.options.resources ?? [] });
      case "resources/templates/list":
        return this.result(id, { resourceTemplates: this.options.resourceTemplates ?? [] });
      case "resources/read": {
        const uri = typeof params.uri === "string" ? params.uri : "";
        const resource = (this.options.resources ?? []).find((item) => item.uri === uri);
        return this.result(id, { contents: resource?.contents ?? [{ uri, mimeType: "text/plain", text: `fixture resource: ${uri}` }] });
      }
      case "prompts/list":
        return this.result(id, { prompts: this.options.prompts ?? [] });
      case "prompts/get": {
        const name = typeof params.name === "string" ? params.name : "";
        return this.result(id, { description: name, messages: [{ role: "user", content: { type: "text", text: `fixture prompt: ${name}` } }] });
      }
      default:
        return this.error(id, -32601, `Unsupported fixture method: ${request.method}`);
    }
  }

  line(line: string): string | undefined {
    const response = this.handle(JSON.parse(line) as unknown);
    return response === undefined ? undefined : JSON.stringify(response);
  }

  private result(id: unknown, result: Record<string, unknown>): Record<string, unknown> {
    return { jsonrpc: "2.0", ...(id === undefined ? {} : { id }), result };
  }

  private error(id: unknown, code: number, message: string): Record<string, unknown> {
    return { jsonrpc: "2.0", ...(id === undefined ? {} : { id }), error: { code, message } };
  }
}

export function mcpStdioServerCommand(options: McpStdioServerOptions = {}): McpStdioServerCommand {
  const config = Buffer.from(JSON.stringify(options), "utf8").toString("base64url");
  return { command: process.execPath, args: [fileURLToPath(new URL("./mcp-stdio-server.js", import.meta.url)), "--config", config] };
}

export function mcpStdioSettingsSnippet(options: McpStdioServerOptions = {}): string {
  const command = mcpStdioServerCommand(options);
  return JSON.stringify({ mcpServers: { "domocode-fixture": { command: [command.command, ...command.args] } } }, null, 2);
}

async function main(): Promise<void> {
  const configIndex = process.argv.indexOf("--config");
  const configValue = configIndex >= 0 ? process.argv[configIndex + 1] : undefined;
  const options = configValue ? JSON.parse(Buffer.from(configValue, "base64url").toString("utf8")) as McpStdioServerOptions : {};
  const server = new McpStdioServer(options);
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const response = server.line(line);
      if (response !== undefined) process.stdout.write(`${response}\n`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
