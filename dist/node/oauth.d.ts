import type { DoMoCodeClient } from "../client.ts";
import { type OAuthRedirectFactory, type RemoteOAuthOptions } from "../oauth.ts";
export interface LoopbackRedirectOptions {
    host?: string;
    port?: number;
    path?: string;
}
/**
 * Bind a fresh local callback listener. The listener rejects mismatched state
 * before resolving the flow and always serves a fixed success page; it never
 * reflects provider-controlled HTML or token material.
 */
export declare function loopbackRedirectFactory(options?: LoopbackRedirectOptions): OAuthRedirectFactory;
/** Open the system browser without putting the authorization URL in a log. */
export declare function openSystemBrowser(url: string): Promise<boolean>;
export interface AuthorizeMcpOptions extends Omit<RemoteOAuthOptions, "redirect"> {
    redirect?: OAuthRedirectFactory;
    loopback?: LoopbackRedirectOptions;
}
/** Node convenience wrapper: loopback listener plus the host's system browser. */
export declare function authorizeMcp(client: DoMoCodeClient, server: string, options?: AuthorizeMcpOptions): Promise<import("../mcp.ts").McpRemoteOAuthResult>;
//# sourceMappingURL=oauth.d.ts.map