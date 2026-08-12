export interface MockAuthorizationServerOptions {
    host?: string;
    port?: number;
    adfsPathAppended?: boolean;
    dynamicRegistration?: boolean;
    requireResource?: boolean;
    requirePKCE?: boolean;
    accessTokenPrefix?: string;
    refreshTokenPrefix?: string;
}
export interface MockAuthorizationRequest {
    url: URL;
    codeChallenge: string;
    state: string;
    redirectUri: string;
    clientId: string;
    resource: string | undefined;
}
export interface MockTokenRequest {
    fields: URLSearchParams;
}
/**
 * A deterministic authorization server for SDK conformance tests. It serves
 * the MCP 401 → protected-resource → ADFS/OIDC metadata chain, RFC 7591,
 * authorization-code + PKCE, and refresh responses that omit refresh_token to
 * exercise non-rotating refresh retention.
 */
export declare class MockAuthorizationServer {
    readonly host: string;
    readonly requestedPort: number;
    readonly authorizationRequests: MockAuthorizationRequest[];
    readonly registrationRequests: Record<string, unknown>[];
    readonly tokenRequests: MockTokenRequest[];
    private readonly adfsPathAppended;
    private readonly dynamicRegistration;
    private readonly requireResource;
    private readonly requirePKCE;
    private readonly accessTokenPrefix;
    private readonly refreshTokenPrefix;
    private readonly issuedCodes;
    private readonly issuedRefreshTokens;
    private server;
    private actualPort;
    private tokenCounter;
    constructor(options?: MockAuthorizationServerOptions);
    get port(): number;
    get baseURL(): string;
    get serverURL(): string;
    get issuerURL(): string;
    get protectedResourceMetadataURL(): string;
    get authorizationEndpoint(): string;
    get tokenEndpoint(): string;
    get registrationEndpoint(): string;
    start(): Promise<this>;
    close(): Promise<void>;
    private handle;
    private handleToken;
    private isAuthorizationMetadataPath;
    private json;
}
//# sourceMappingURL=mock-authorization-server.d.ts.map