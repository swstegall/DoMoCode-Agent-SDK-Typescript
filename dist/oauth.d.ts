import { DoMoError } from "./types/errors.ts";
import type { FetchFunction } from "./transport.ts";
import type { McpOAuthConfiguration, McpOAuthCredential } from "./types/mcp.ts";
export interface OAuthCallback {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
}
export interface OAuthRedirectSession {
    readonly redirectUri: string;
    setExpectedState?(state: string): void;
    waitForCallback(input: {
        authorizationUrl: string;
        signal: AbortSignal;
        openAuthorization?: (authorizationUrl: string) => Promise<boolean> | boolean;
    }): Promise<OAuthCallback | string>;
    close?(): Promise<void> | void;
}
export type OAuthRedirectFactory = (input: {
    signal: AbortSignal;
}) => Promise<OAuthRedirectSession>;
export interface RemoteOAuthOptions {
    fetch?: FetchFunction;
    signal?: AbortSignal;
    timeoutMs?: number;
    openAuthorization?: (authorizationUrl: string) => Promise<boolean> | boolean;
    redirect?: OAuthRedirectFactory;
    redirectUri?: string;
    waitForRedirect?: (input: {
        authorizationUrl: string;
        redirectUri: string;
        signal: AbortSignal;
    }) => Promise<OAuthCallback | string>;
    clientName?: string;
}
export interface OAuthDiscoveryResult {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    registrationEndpoint?: string;
    issuer?: string;
    codeChallengeMethodsSupported?: string[];
    scopesSupported?: string[];
    scopeHint?: string;
    resource?: string;
}
export declare class OAuthFlowError extends DoMoError {
    readonly code: string | undefined;
    constructor(message: string, code?: string, options?: {
        cause?: unknown;
    });
}
/**
 * Run the remote authorization-code + PKCE flow without depending on a
 * browser or Node runtime. Hosts provide either a redirect session (Node's
 * loopback helper does this) or a browser/web callback bridge.
 */
export declare function authorizeRemoteOAuth(configuration: McpOAuthConfiguration, options?: RemoteOAuthOptions): Promise<McpOAuthCredential>;
/** Resolve missing endpoints using MCP protected-resource and RFC 8414/OIDC discovery. */
export declare function resolveOAuthConfiguration(configuration: McpOAuthConfiguration, options?: {
    fetch?: FetchFunction;
    signal?: AbortSignal;
    wwwAuthenticate?: string;
}): Promise<McpOAuthConfiguration>;
/** The discovery chain is exported so browser hosts can run it before choosing a redirect UX. */
export declare function discoverOAuth(serverURL: string, options?: {
    fetch?: FetchFunction;
    signal?: AbortSignal;
    wwwAuthenticate?: string;
}): Promise<OAuthDiscoveryResult>;
/** Refresh an imported credential, retaining a non-rotating refresh token when omitted. */
export declare function refreshRemoteOAuth(configuration: McpOAuthConfiguration, credential: McpOAuthCredential, options?: Pick<RemoteOAuthOptions, "fetch" | "signal">): Promise<McpOAuthCredential>;
//# sourceMappingURL=oauth.d.ts.map