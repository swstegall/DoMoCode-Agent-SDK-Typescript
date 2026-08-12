import type { Transport } from "./transport.ts";
import { encodePathSegment } from "./transport.ts";
import { isRecord, requiredArray, requiredBoolean, requiredNumber, requiredString, type JSONValue } from "./types/common.ts";
import type { McpConnectResult, McpLogoutResult, McpResourceInfo, McpResourceRead, McpResourceTemplateInfo, McpServerHealth, McpServerStatusInfo, McpServerStatusMap, McpTransport } from "./types/mcp.ts";

export interface McpClientOptions { maxAgeMs?: number }
export interface McpConnectOptions {
  openAuthorization?: (authorizationUrl: string) => Promise<boolean> | boolean;
}

interface CacheEntry<T> { value: T; expiresAt: number }

/** Typed access to the process-scoped MCP admin routes.
 *
 * The SDK never speaks MCP JSON-RPC. The Swift server remains the connection
 * owner, and this client only consumes its redacted status/catalog projections.
 */
export class McpClient {
  private readonly maxAgeMs: number;
  private serverCache: CacheEntry<McpServerStatusMap> | undefined;
  private readonly resourceCache = new Map<string, CacheEntry<McpResourceInfo[]>>();
  private readonly templateCache = new Map<string, CacheEntry<McpResourceTemplateInfo[]>>();

  constructor(private readonly transport: Transport, options: McpClientOptions = {}) {
    this.maxAgeMs = options.maxAgeMs ?? 10_000;
  }

  async servers(options: McpClientOptions = {}): Promise<McpServerStatusMap> {
    const maxAgeMs = options.maxAgeMs ?? this.maxAgeMs;
    if (maxAgeMs > 0 && this.serverCache && this.serverCache.expiresAt > Date.now()) return this.serverCache.value;
    const value = decodeMcpServerStatusMap(await this.transport.json<unknown>("/mcp"));
    if (maxAgeMs > 0) this.serverCache = { value, expiresAt: Date.now() + maxAgeMs };
    return value;
  }

  async health(server: string): Promise<McpServerHealth[]> {
    assertServerName(server);
    const value = await this.transport.json<unknown>(`/mcp/${encodePathSegment(server)}/health`);
    return requiredArray(value, "MCP health").map(decodeMcpServerHealth);
  }

  async resources(server: string, options: McpClientOptions = {}): Promise<McpResourceInfo[]> {
    assertServerName(server);
    const maxAgeMs = options.maxAgeMs ?? this.maxAgeMs;
    const cached = this.resourceCache.get(server);
    if (maxAgeMs > 0 && cached && cached.expiresAt > Date.now()) return cached.value;
    const value = requiredArray(await this.transport.json<unknown>(`/mcp/${encodePathSegment(server)}/resources`), "MCP resources").map(decodeMcpResourceInfo);
    if (maxAgeMs > 0) this.resourceCache.set(server, { value, expiresAt: Date.now() + maxAgeMs });
    return value;
  }

  async resourceTemplates(server: string, options: McpClientOptions = {}): Promise<McpResourceTemplateInfo[]> {
    assertServerName(server);
    const maxAgeMs = options.maxAgeMs ?? this.maxAgeMs;
    const cached = this.templateCache.get(server);
    if (maxAgeMs > 0 && cached && cached.expiresAt > Date.now()) return cached.value;
    const value = requiredArray(await this.transport.json<unknown>(`/mcp/${encodePathSegment(server)}/resource-templates`), "MCP resource templates").map(decodeMcpResourceTemplateInfo);
    if (maxAgeMs > 0) this.templateCache.set(server, { value, expiresAt: Date.now() + maxAgeMs });
    return value;
  }

  async readResource(server: string, uri: string): Promise<McpResourceRead> {
    assertServerName(server);
    if (!uri) throw new TypeError("MCP resource uri is required");
    return decodeMcpResourceRead(await this.transport.json<unknown>(`/mcp/${encodePathSegment(server)}/resource`, { method: "POST", body: { uri } }));
  }

  /** Start a server-owned MCP connection, optionally handing its OAuth URL to the host. */
  async connect(server: string, options: McpConnectOptions = {}): Promise<McpConnectResult> {
    assertServerName(server);
    const result = decodeMcpConnectResult(await this.transport.json<unknown>(`/mcp/${encodePathSegment(server)}/connect`, { method: "POST" }));
    if (result.authorizationUrl !== undefined) await options.openAuthorization?.(result.authorizationUrl);
    this.invalidate(server);
    return result;
  }

  /** Disconnect a configured MCP server and discard server-side OAuth state. */
  async logout(server: string): Promise<McpLogoutResult> {
    assertServerName(server);
    const result = decodeMcpLogoutResult(await this.transport.json<unknown>(`/mcp/${encodePathSegment(server)}/logout`, { method: "POST" }));
    this.invalidate(server);
    return result;
  }

  /** Invalidate status and catalog snapshots after an `mcp_changed` frame. */
  invalidate(server?: string): void {
    this.serverCache = undefined;
    if (server === undefined) {
      this.resourceCache.clear();
      this.templateCache.clear();
      return;
    }
    this.resourceCache.delete(server);
    this.templateCache.delete(server);
  }
}

export function decodeMcpServerStatusMap(value: unknown): McpServerStatusMap {
  if (!isRecord(value)) throw new TypeError("MCP server status response must be an object");
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, decodeMcpServerStatusInfo(item)]));
}

export function decodeMcpServerStatusInfo(value: unknown): McpServerStatusInfo {
  if (!isRecord(value)) throw new TypeError("MCP server status must be an object");
  return {
    status: requiredString(value.status, "MCP status") as McpServerStatusInfo["status"],
    transport: requiredString(value.transport, "MCP transport") as McpTransport,
    toolCount: requiredNumber(value.toolCount, "MCP toolCount"),
    ...(value.error === undefined || value.error === null ? {} : { error: requiredString(value.error, "MCP error") }),
    ...(value.endpoint === undefined || value.endpoint === null ? {} : { endpoint: requiredString(value.endpoint, "MCP endpoint") })
  };
}

export function decodeMcpConnectResult(value: unknown): McpConnectResult {
  if (!isRecord(value)) throw new TypeError("MCP connect response must be an object");
  return {
    status: requiredString(value.status, "MCP connect status") as McpConnectResult["status"],
    ...(value.authorizationUrl === undefined || value.authorizationUrl === null ? {} : { authorizationUrl: requiredString(value.authorizationUrl, "MCP authorizationUrl") }),
    ...(value.flowId === undefined || value.flowId === null ? {} : { flowId: requiredString(value.flowId, "MCP flowId") }),
    ...(value.initiator === undefined || value.initiator === null ? {} : { initiator: requiredString(value.initiator, "MCP initiator") })
  };
}

export function decodeMcpLogoutResult(value: unknown): McpLogoutResult {
  if (!isRecord(value)) throw new TypeError("MCP logout response must be an object");
  return { status: requiredString(value.status, "MCP logout status") as McpLogoutResult["status"] };
}

export function decodeMcpResourceInfo(value: unknown): McpResourceInfo {
  if (!isRecord(value)) throw new TypeError("MCP resource must be an object");
  return {
    server: requiredString(value.server, "MCP resource server"),
    uri: requiredString(value.uri, "MCP resource uri"),
    name: requiredString(value.name, "MCP resource name"),
    ...(value.description === undefined || value.description === null ? {} : { description: requiredString(value.description, "MCP resource description") }),
    ...(value.mimeType === undefined || value.mimeType === null ? {} : { mimeType: requiredString(value.mimeType, "MCP resource mimeType") })
  };
}

export function decodeMcpResourceTemplateInfo(value: unknown): McpResourceTemplateInfo {
  if (!isRecord(value)) throw new TypeError("MCP resource template must be an object");
  return {
    server: requiredString(value.server, "MCP resource template server"),
    uriTemplate: requiredString(value.uriTemplate, "MCP resource template uriTemplate"),
    name: requiredString(value.name, "MCP resource template name"),
    ...(value.description === undefined || value.description === null ? {} : { description: requiredString(value.description, "MCP resource template description") }),
    ...(value.mimeType === undefined || value.mimeType === null ? {} : { mimeType: requiredString(value.mimeType, "MCP resource template mimeType") })
  };
}

export function decodeMcpResourceRead(value: unknown): McpResourceRead {
  if (!isRecord(value)) throw new TypeError("MCP resource read must be an object");
  return {
    server: requiredString(value.server, "MCP read server"),
    uri: requiredString(value.uri, "MCP read uri"),
    contents: requiredArray(value.contents, "MCP read contents") as JSONValue[]
  };
}

export function decodeMcpServerHealth(value: unknown): McpServerHealth {
  if (!isRecord(value)) throw new TypeError("MCP health entry must be an object");
  return { server: requiredString(value.server, "MCP health server"), healthy: requiredBoolean(value.healthy, "MCP health healthy") };
}

function assertServerName(server: string): void {
  if (!server) throw new TypeError("MCP server name is required");
}
