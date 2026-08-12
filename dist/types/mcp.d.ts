import type { JSONValue, OpenEnum } from "./common.ts";
export type McpServerStatus = OpenEnum<"connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration">;
export type McpTransport = OpenEnum<"stdio" | "streamable-http" | "sse">;
export interface McpServerStatusInfo {
    status: McpServerStatus;
    transport: McpTransport;
    toolCount: number;
    error?: string;
    endpoint?: string;
}
export type McpServerStatusMap = Record<string, McpServerStatusInfo>;
export interface McpConnectResult {
    status: McpServerStatus;
    authorizationUrl?: string;
    flowId?: string;
    initiator?: string;
}
export interface McpLogoutResult {
    status: McpServerStatus;
}
export interface McpOAuthTokens {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    refreshTokenExpiresAt?: number;
    scope?: string;
}
export interface McpOAuthClientRegistration {
    clientId: string;
    clientSecret?: string;
    clientSecretExpiresAt?: number;
}
export interface McpOAuthConfiguration {
    serverUrl: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    registrationEndpoint?: string;
    issuer?: string;
    codeChallengeMethodsSupported?: string[];
    scopesSupported?: string[];
    clientId?: string;
    scope?: string;
    resource?: string;
    redirectUri?: string;
    cacheKey?: string;
}
export interface McpOAuthCredential {
    tokens: McpOAuthTokens;
    client?: McpOAuthClientRegistration;
}
export interface McpResourceInfo {
    server: string;
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}
export interface McpResourceTemplateInfo {
    server: string;
    uriTemplate: string;
    name: string;
    description?: string;
    mimeType?: string;
}
export interface McpResourceRead {
    server: string;
    uri: string;
    contents: JSONValue[];
}
export interface McpServerHealth {
    server: string;
    healthy: boolean;
}
//# sourceMappingURL=mcp.d.ts.map