import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
/**
 * A deterministic authorization server for SDK conformance tests. It serves
 * the MCP 401 → protected-resource → ADFS/OIDC metadata chain, RFC 7591,
 * authorization-code + PKCE, and refresh responses that omit refresh_token to
 * exercise non-rotating refresh retention.
 */
export class MockAuthorizationServer {
    host;
    requestedPort;
    authorizationRequests = [];
    registrationRequests = [];
    tokenRequests = [];
    adfsPathAppended;
    dynamicRegistration;
    requireResource;
    requirePKCE;
    accessTokenPrefix;
    refreshTokenPrefix;
    issuedCodes = new Map();
    issuedRefreshTokens = new Set();
    server;
    actualPort;
    tokenCounter = 0;
    constructor(options = {}) {
        this.host = options.host ?? "127.0.0.1";
        this.requestedPort = options.port ?? 0;
        this.adfsPathAppended = options.adfsPathAppended ?? false;
        this.dynamicRegistration = options.dynamicRegistration ?? true;
        this.requireResource = options.requireResource ?? true;
        this.requirePKCE = options.requirePKCE ?? true;
        this.accessTokenPrefix = options.accessTokenPrefix ?? "mock-access";
        this.refreshTokenPrefix = options.refreshTokenPrefix ?? "mock-refresh";
    }
    get port() { return this.actualPort ?? this.requestedPort; }
    get baseURL() { return `http://${this.host}:${this.port}`; }
    get serverURL() { return `${this.baseURL}/mcp`; }
    get issuerURL() { return `${this.baseURL}/adfs`; }
    get protectedResourceMetadataURL() { return `${this.baseURL}/.well-known/oauth-protected-resource/mcp`; }
    get authorizationEndpoint() { return `${this.baseURL}/authorize`; }
    get tokenEndpoint() { return `${this.baseURL}/token`; }
    get registrationEndpoint() { return `${this.baseURL}/register`; }
    async start() {
        if (this.server)
            return this;
        this.server = createServer((request, response) => { void this.handle(request, response); });
        this.server.listen(this.requestedPort, this.host);
        await once(this.server, "listening");
        const address = this.server.address();
        if (address && typeof address === "object")
            this.actualPort = address.port;
        return this;
    }
    async close() {
        if (!this.server)
            return;
        const closed = once(this.server, "close").catch(() => undefined);
        this.server.close();
        await closed;
        this.server = undefined;
        this.actualPort = undefined;
    }
    async handle(request, response) {
        const url = new URL(request.url ?? "/", this.baseURL);
        try {
            if (request.method === "GET" && url.pathname === "/mcp") {
                response.writeHead(401, { "www-authenticate": `Bearer resource_metadata="${this.protectedResourceMetadataURL}", scope="mcp.read"` });
                response.end();
                return;
            }
            if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
                this.json(response, {
                    resource: this.serverURL,
                    authorization_servers: [this.issuerURL],
                    scopes_supported: ["mcp.read"]
                });
                return;
            }
            if (request.method === "GET" && this.isAuthorizationMetadataPath(url.pathname)) {
                this.json(response, {
                    issuer: this.issuerURL,
                    authorization_endpoint: this.authorizationEndpoint,
                    token_endpoint: this.tokenEndpoint,
                    ...(this.dynamicRegistration ? { registration_endpoint: this.registrationEndpoint } : {}),
                    code_challenge_methods_supported: ["S256"],
                    scopes_supported: ["mcp.read"]
                });
                return;
            }
            if (request.method === "POST" && url.pathname === "/register") {
                const value = await readJSONBody(request);
                this.registrationRequests.push(value);
                this.json(response, { client_id: `mock-client-${this.registrationRequests.length}`, token_endpoint_auth_method: "none" }, 201);
                return;
            }
            if (request.method === "GET" && url.pathname === "/authorize") {
                const codeChallenge = url.searchParams.get("code_challenge");
                const state = url.searchParams.get("state");
                const redirectUri = url.searchParams.get("redirect_uri");
                const clientId = url.searchParams.get("client_id");
                if (!codeChallenge || !state || !redirectUri || !clientId || (this.requirePKCE && url.searchParams.get("code_challenge_method") !== "S256")) {
                    response.writeHead(400).end("invalid authorization request");
                    return;
                }
                const requestInfo = {
                    url,
                    codeChallenge,
                    state,
                    redirectUri,
                    clientId,
                    resource: url.searchParams.get("resource") ?? undefined
                };
                this.authorizationRequests.push(requestInfo);
                const code = `mock-code-${this.authorizationRequests.length}`;
                this.issuedCodes.set(code, requestInfo);
                const callback = new URL(redirectUri);
                callback.searchParams.set("code", code);
                callback.searchParams.set("state", state);
                response.writeHead(302, { location: callback.toString() });
                response.end();
                return;
            }
            if (request.method === "POST" && url.pathname === "/token") {
                await this.handleToken(request, response);
                return;
            }
            response.writeHead(404).end();
        }
        catch {
            response.writeHead(500).end();
        }
    }
    async handleToken(request, response) {
        const fields = new URLSearchParams(await readBody(request));
        this.tokenRequests.push({ fields });
        const grantType = fields.get("grant_type");
        const resource = fields.get("resource");
        if (this.requireResource && resource !== this.serverURL) {
            this.json(response, { error: "invalid_target", error_description: "resource is required" }, 400);
            return;
        }
        if (grantType === "authorization_code") {
            const code = fields.get("code");
            const verifier = fields.get("code_verifier");
            const pending = code ? this.issuedCodes.get(code) : undefined;
            if (!pending || !verifier || (this.requirePKCE && base64URL(new Uint8Array(createHash("sha256").update(verifier).digest())) !== pending.codeChallenge)) {
                this.json(response, { error: "invalid_grant" }, 400);
                return;
            }
            this.issuedCodes.delete(code);
            const accessToken = `${this.accessTokenPrefix}-${++this.tokenCounter}`;
            const refreshToken = `${this.refreshTokenPrefix}-${this.tokenCounter}`;
            this.issuedRefreshTokens.add(refreshToken);
            this.json(response, {
                access_token: accessToken,
                token_type: "Bearer",
                expires_in: 3600,
                refresh_token: refreshToken,
                refresh_token_expires_in: 86_400,
                scope: "mcp.read"
            });
            return;
        }
        if (grantType === "refresh_token") {
            const refreshToken = fields.get("refresh_token");
            if (!refreshToken || !this.issuedRefreshTokens.has(refreshToken)) {
                this.json(response, { error: "invalid_grant" }, 400);
                return;
            }
            this.json(response, { access_token: `${this.accessTokenPrefix}-refresh-${++this.tokenCounter}`, token_type: "Bearer", expires_in: 3600, scope: "mcp.read" });
            return;
        }
        this.json(response, { error: "unsupported_grant_type" }, 400);
    }
    isAuthorizationMetadataPath(path) {
        if (this.adfsPathAppended)
            return path === "/adfs/.well-known/openid-configuration";
        return path === "/.well-known/oauth-authorization-server/adfs" || path === "/.well-known/oauth-authorization-server";
    }
    json(response, value, status = 200) {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
    }
}
async function readBody(request) {
    let value = "";
    request.setEncoding("utf8");
    for await (const chunk of request)
        value += chunk;
    return value;
}
async function readJSONBody(request) {
    const body = await readBody(request);
    const value = JSON.parse(body);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function base64URL(bytes) {
    return Buffer.from(bytes).toString("base64url");
}
//# sourceMappingURL=mock-authorization-server.js.map