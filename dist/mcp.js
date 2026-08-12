import { encodePathSegment } from "./transport.js";
import { isRecord, requiredArray, requiredBoolean, requiredNumber, requiredString } from "./types/common.js";
import { authorizeRemoteOAuth, refreshRemoteOAuth } from "./oauth.js";
/** Typed access to the process-scoped MCP admin routes.
 *
 * The SDK never speaks MCP JSON-RPC. The Swift server remains the connection
 * owner, and this client only consumes its redacted status/catalog projections.
 */
export class McpClient {
    transport;
    maxAgeMs;
    serverCache;
    resourceCache = new Map();
    templateCache = new Map();
    constructor(transport, options = {}) {
        this.transport = transport;
        this.maxAgeMs = options.maxAgeMs ?? 10_000;
    }
    async servers(options = {}) {
        const maxAgeMs = options.maxAgeMs ?? this.maxAgeMs;
        if (maxAgeMs > 0 && this.serverCache && this.serverCache.expiresAt > Date.now())
            return this.serverCache.value;
        const value = decodeMcpServerStatusMap(await this.transport.json("/mcp"));
        if (maxAgeMs > 0)
            this.serverCache = { value, expiresAt: Date.now() + maxAgeMs };
        return value;
    }
    async health(server) {
        assertServerName(server);
        const value = await this.transport.json(`/mcp/${encodePathSegment(server)}/health`);
        return requiredArray(value, "MCP health").map(decodeMcpServerHealth);
    }
    async resources(server, options = {}) {
        assertServerName(server);
        const maxAgeMs = options.maxAgeMs ?? this.maxAgeMs;
        const cached = this.resourceCache.get(server);
        if (maxAgeMs > 0 && cached && cached.expiresAt > Date.now())
            return cached.value;
        const value = requiredArray(await this.transport.json(`/mcp/${encodePathSegment(server)}/resources`), "MCP resources").map(decodeMcpResourceInfo);
        if (maxAgeMs > 0)
            this.resourceCache.set(server, { value, expiresAt: Date.now() + maxAgeMs });
        return value;
    }
    async resourceTemplates(server, options = {}) {
        assertServerName(server);
        const maxAgeMs = options.maxAgeMs ?? this.maxAgeMs;
        const cached = this.templateCache.get(server);
        if (maxAgeMs > 0 && cached && cached.expiresAt > Date.now())
            return cached.value;
        const value = requiredArray(await this.transport.json(`/mcp/${encodePathSegment(server)}/resource-templates`), "MCP resource templates").map(decodeMcpResourceTemplateInfo);
        if (maxAgeMs > 0)
            this.templateCache.set(server, { value, expiresAt: Date.now() + maxAgeMs });
        return value;
    }
    async readResource(server, uri) {
        assertServerName(server);
        if (!uri)
            throw new TypeError("MCP resource uri is required");
        return decodeMcpResourceRead(await this.transport.json(`/mcp/${encodePathSegment(server)}/resource`, { method: "POST", body: { uri } }));
    }
    /** Start a server-owned MCP connection, optionally handing its OAuth URL to the host. */
    async connect(server, options = {}) {
        assertServerName(server);
        const result = decodeMcpConnectResult(await this.transport.json(`/mcp/${encodePathSegment(server)}/connect`, { method: "POST" }));
        if (result.authorizationUrl !== undefined)
            await options.openAuthorization?.(result.authorizationUrl);
        this.invalidate(server);
        return result;
    }
    /** Disconnect a configured MCP server and discard server-side OAuth state. */
    async logout(server) {
        assertServerName(server);
        const result = decodeMcpLogoutResult(await this.transport.json(`/mcp/${encodePathSegment(server)}/logout`, { method: "POST" }));
        this.invalidate(server);
        return result;
    }
    /** Read the server's sanitized OAuth block and discovered endpoints. */
    async oauthConfiguration(server) {
        assertServerName(server);
        return decodeMcpOAuthConfiguration(await this.transport.json(`/mcp/${encodePathSegment(server)}/oauth/config`));
    }
    /** Import a remote-client credential and ask the server to reconnect. */
    async importTokens(server, tokens, client) {
        assertServerName(server);
        if (!tokens.accessToken)
            throw new TypeError("MCP OAuth accessToken is required");
        const result = decodeMcpConnectResult(await this.transport.json(`/mcp/${encodePathSegment(server)}/tokens`, {
            method: "POST",
            body: { tokens, ...(client === undefined ? {} : { client }) }
        }));
        this.invalidate(server);
        return result;
    }
    /** Complete a remote OAuth flow in the SDK, then import its credential. */
    async authorizeRemote(server, options = {}) {
        const configuration = await this.oauthConfiguration(server);
        const credential = await authorizeRemoteOAuth(configuration, options);
        const connection = await this.importTokens(server, credential.tokens, credential.client);
        return { credential, connection };
    }
    /** Refresh an imported credential without exposing token material to logs. */
    async refreshRemote(server, credential, options = {}) {
        const configuration = await this.oauthConfiguration(server);
        const refreshed = await refreshRemoteOAuth(configuration, credential, options);
        const connection = await this.importTokens(server, refreshed.tokens, refreshed.client);
        return { credential: refreshed, connection };
    }
    /** Invalidate status and catalog snapshots after an `mcp_changed` frame. */
    invalidate(server) {
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
export function decodeMcpServerStatusMap(value) {
    if (!isRecord(value))
        throw new TypeError("MCP server status response must be an object");
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, decodeMcpServerStatusInfo(item)]));
}
export function decodeMcpServerStatusInfo(value) {
    if (!isRecord(value))
        throw new TypeError("MCP server status must be an object");
    return {
        status: requiredString(value.status, "MCP status"),
        transport: requiredString(value.transport, "MCP transport"),
        toolCount: requiredNumber(value.toolCount, "MCP toolCount"),
        ...(value.error === undefined || value.error === null ? {} : { error: requiredString(value.error, "MCP error") }),
        ...(value.endpoint === undefined || value.endpoint === null ? {} : { endpoint: requiredString(value.endpoint, "MCP endpoint") })
    };
}
export function decodeMcpConnectResult(value) {
    if (!isRecord(value))
        throw new TypeError("MCP connect response must be an object");
    return {
        status: requiredString(value.status, "MCP connect status"),
        ...(value.authorizationUrl === undefined || value.authorizationUrl === null ? {} : { authorizationUrl: requiredString(value.authorizationUrl, "MCP authorizationUrl") }),
        ...(value.flowId === undefined || value.flowId === null ? {} : { flowId: requiredString(value.flowId, "MCP flowId") }),
        ...(value.initiator === undefined || value.initiator === null ? {} : { initiator: requiredString(value.initiator, "MCP initiator") })
    };
}
export function decodeMcpLogoutResult(value) {
    if (!isRecord(value))
        throw new TypeError("MCP logout response must be an object");
    return { status: requiredString(value.status, "MCP logout status") };
}
export function decodeMcpOAuthConfiguration(value) {
    if (!isRecord(value))
        throw new TypeError("MCP OAuth configuration must be an object");
    return {
        serverUrl: requiredString(value.serverUrl, "MCP OAuth serverUrl"),
        ...(value.authorizationEndpoint === undefined || value.authorizationEndpoint === null ? {} : { authorizationEndpoint: requiredString(value.authorizationEndpoint, "MCP OAuth authorizationEndpoint") }),
        ...(value.tokenEndpoint === undefined || value.tokenEndpoint === null ? {} : { tokenEndpoint: requiredString(value.tokenEndpoint, "MCP OAuth tokenEndpoint") }),
        ...(value.registrationEndpoint === undefined || value.registrationEndpoint === null ? {} : { registrationEndpoint: requiredString(value.registrationEndpoint, "MCP OAuth registrationEndpoint") }),
        ...(value.issuer === undefined || value.issuer === null ? {} : { issuer: requiredString(value.issuer, "MCP OAuth issuer") }),
        ...(value.codeChallengeMethodsSupported === undefined || value.codeChallengeMethodsSupported === null ? {} : { codeChallengeMethodsSupported: requiredArray(value.codeChallengeMethodsSupported, "MCP OAuth codeChallengeMethodsSupported").map((item) => requiredString(item, "MCP OAuth PKCE method")) }),
        ...(value.scopesSupported === undefined || value.scopesSupported === null ? {} : { scopesSupported: requiredArray(value.scopesSupported, "MCP OAuth scopesSupported").map((item) => requiredString(item, "MCP OAuth scope")) }),
        ...(value.clientId === undefined || value.clientId === null ? {} : { clientId: requiredString(value.clientId, "MCP OAuth clientId") }),
        ...(value.scope === undefined || value.scope === null ? {} : { scope: requiredString(value.scope, "MCP OAuth scope") }),
        ...(value.resource === undefined || value.resource === null ? {} : { resource: requiredString(value.resource, "MCP OAuth resource") }),
        ...(value.redirectUri === undefined || value.redirectUri === null ? {} : { redirectUri: requiredString(value.redirectUri, "MCP OAuth redirectUri") }),
        ...(value.cacheKey === undefined || value.cacheKey === null ? {} : { cacheKey: requiredString(value.cacheKey, "MCP OAuth cacheKey") })
    };
}
export function decodeMcpResourceInfo(value) {
    if (!isRecord(value))
        throw new TypeError("MCP resource must be an object");
    return {
        server: requiredString(value.server, "MCP resource server"),
        uri: requiredString(value.uri, "MCP resource uri"),
        name: requiredString(value.name, "MCP resource name"),
        ...(value.description === undefined || value.description === null ? {} : { description: requiredString(value.description, "MCP resource description") }),
        ...(value.mimeType === undefined || value.mimeType === null ? {} : { mimeType: requiredString(value.mimeType, "MCP resource mimeType") })
    };
}
export function decodeMcpResourceTemplateInfo(value) {
    if (!isRecord(value))
        throw new TypeError("MCP resource template must be an object");
    return {
        server: requiredString(value.server, "MCP resource template server"),
        uriTemplate: requiredString(value.uriTemplate, "MCP resource template uriTemplate"),
        name: requiredString(value.name, "MCP resource template name"),
        ...(value.description === undefined || value.description === null ? {} : { description: requiredString(value.description, "MCP resource template description") }),
        ...(value.mimeType === undefined || value.mimeType === null ? {} : { mimeType: requiredString(value.mimeType, "MCP resource template mimeType") })
    };
}
export function decodeMcpResourceRead(value) {
    if (!isRecord(value))
        throw new TypeError("MCP resource read must be an object");
    return {
        server: requiredString(value.server, "MCP read server"),
        uri: requiredString(value.uri, "MCP read uri"),
        contents: requiredArray(value.contents, "MCP read contents")
    };
}
export function decodeMcpServerHealth(value) {
    if (!isRecord(value))
        throw new TypeError("MCP health entry must be an object");
    return { server: requiredString(value.server, "MCP health server"), healthy: requiredBoolean(value.healthy, "MCP health healthy") };
}
function assertServerName(server) {
    if (!server)
        throw new TypeError("MCP server name is required");
}
//# sourceMappingURL=mcp.js.map